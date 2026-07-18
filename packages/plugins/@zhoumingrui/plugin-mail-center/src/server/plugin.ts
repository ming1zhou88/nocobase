/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Context as ActionContext, Next } from '@nocobase/actions';
import WorkflowPlugin from '@nocobase/plugin-workflow';
import { Plugin, type DefaultContext } from '@nocobase/server';
import { AttachmentStorageService } from './services/attachment-storage.service';
import { MailAccountService, type MailAccountInput } from './services/account.service';
import { ImapSyncService } from './services/imap-sync.service';
import { MessageService, type MessageListOptions } from './services/message.service';
import { SettingsService, type SettingType } from './services/settings.service';
import { SmtpService } from './services/smtp.service';
import type { MailAccountData, OutgoingMessage } from './types';
import { MailReceivedTrigger } from './workflow/mail-received-trigger';

const NAMESPACE = '@zhoumingrui/plugin-mail-center';

type MailActionContext = ActionContext & DefaultContext;
type ActionHandler = (ctx: MailActionContext) => Promise<unknown>;

interface BulkSendInput {
  accountId: number;
  recipients: string[];
  message: Omit<OutgoingMessage, 'to'>;
}

interface SettingsInput {
  type: SettingType;
  record: Record<string, unknown>;
}

function currentOwnerId(ctx: MailActionContext): number {
  const state = ctx.state as { currentUser?: { id?: number | string } };
  const ownerId = Number(state.currentUser?.id);
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    ctx.throw(401, ctx.t('Authentication required', { ns: NAMESPACE }));
  }
  return ownerId;
}

function actionValues<T>(ctx: MailActionContext): T {
  return (ctx.action.params.values || {}) as unknown as T;
}

export class PluginMailCenterServer extends Plugin {
  private accounts!: MailAccountService;
  private attachments!: AttachmentStorageService;
  private imap!: ImapSyncService;
  private messages!: MessageService;
  private settings!: SettingsService;
  private smtp!: SmtpService;

  async afterAdd() {
    this.accounts = new MailAccountService(this.app);
    this.attachments = new AttachmentStorageService(this.app);
    this.smtp = new SmtpService();
    this.imap = new ImapSyncService(this.app, this.accounts, this.attachments);
    this.messages = new MessageService(this.app, this.accounts, this.smtp, this.attachments);
    this.settings = new SettingsService(this.app, this.accounts);
  }

  async beforeLoad() {
    this.app.cronJobManager.addJob({
      cronTime: '0 * * * * *',
      onTick: async () => {
        try {
          await this.imap.syncDueAccounts();
        } catch (error) {
          this.app.logger.error('[Mail center] scheduled synchronization failed', { error });
        }
        try {
          await this.messages.processScheduled();
        } catch (error) {
          this.app.logger.error('[Mail center] scheduled sending failed', { error });
        }
      },
    });
  }

  async load() {
    const workflowPlugin = this.app.pm.get(WorkflowPlugin) as WorkflowPlugin;
    const mailTrigger = new MailReceivedTrigger(workflowPlugin);
    workflowPlugin.triggers.register(MailReceivedTrigger.TYPE, mailTrigger);
    this.imap.setTrigger(mailTrigger);

    this.app.resourceManager.define({
      name: 'mailCenter',
      actions: {
        accountsList: this.action(async (ctx) => this.accounts.list(currentOwnerId(ctx))),
        accountSave: this.action(async (ctx) => {
          const ownerId = currentOwnerId(ctx);
          const saved = await this.accounts.save(ownerId, actionValues<MailAccountInput>(ctx));
          return this.sanitizeAccount(saved);
        }),
        accountDelete: this.action(async (ctx) => {
          await this.accounts.destroy(currentOwnerId(ctx), Number(ctx.action.params.filterByTk));
          return { success: true };
        }),
        accountTest: this.action(async (ctx) => {
          const account = await this.accounts.getOwned(currentOwnerId(ctx), Number(ctx.action.params.filterByTk));
          await this.imap.verify(account);
          await this.smtp.verify(account);
          return { success: true };
        }),
        accountCheck: this.action(async (ctx) => {
          const ownerId = currentOwnerId(ctx);
          const values = actionValues<MailAccountInput>(ctx);
          let password = values.password;
          if (!password && values.id) {
            password = (await this.accounts.getOwned(ownerId, values.id)).password;
          }
          if (!password) {
            throw new Error('Password is required');
          }
          const account: MailAccountData = {
            id: values.id || 0,
            ownerId,
            name: values.name,
            email: values.email,
            senderName: values.senderName,
            enabled: values.enabled ?? true,
            imapHost: values.imapHost,
            imapPort: values.imapPort,
            imapSecure: values.imapSecure ?? true,
            smtpHost: values.smtpHost,
            smtpPort: values.smtpPort,
            smtpSecure: values.smtpSecure ?? true,
            username: values.username,
            password,
            syncIntervalMinutes: values.syncIntervalMinutes || 5,
            lastUid: 0,
          };
          await this.imap.verify(account);
          await this.smtp.verify(account);
          return { success: true };
        }),
        accountSync: this.action(async (ctx) => {
          const account = await this.accounts.getOwned(currentOwnerId(ctx), Number(ctx.action.params.filterByTk));
          return this.imap.sync(account);
        }),
        messagesList: this.action(async (ctx) =>
          this.messages.list(currentOwnerId(ctx), actionValues<MessageListOptions>(ctx)),
        ),
        markRead: this.action(async (ctx) => {
          const values = actionValues<{ ids: number[]; isRead: boolean }>(ctx);
          await this.messages.markRead(currentOwnerId(ctx), values.ids, values.isRead);
          return { success: true };
        }),
        move: this.action(async (ctx) => {
          const values = actionValues<{ ids: number[]; box: string }>(ctx);
          await this.messages.move(currentOwnerId(ctx), values.ids, values.box);
          return { success: true };
        }),
        updateMessageMetadata: this.action(async (ctx) => {
          const values = actionValues<{
            id: number;
            note?: string;
            isTodo?: boolean;
            labelIds?: number[];
          }>(ctx);
          await this.messages.updateMetadata(currentOwnerId(ctx), values.id, values);
          return { success: true };
        }),
        send: this.action(async (ctx) => {
          const values = actionValues<{ accountId: number; message: OutgoingMessage }>(ctx);
          return this.messages.send(currentOwnerId(ctx), values.accountId, values.message);
        }),
        bulkSend: this.action(async (ctx) => {
          const values = actionValues<BulkSendInput>(ctx);
          return this.messages.sendBulk(currentOwnerId(ctx), values.accountId, values.recipients, values.message);
        }),
        saveDraft: this.action(async (ctx) => {
          const values = actionValues<{ accountId: number; message: OutgoingMessage }>(ctx);
          return this.messages.saveDraft(currentOwnerId(ctx), values.accountId, values.message);
        }),
        schedule: this.action(async (ctx) => {
          const values = actionValues<{ accountId: number; message: OutgoingMessage; scheduledAt: string }>(ctx);
          return this.messages.schedule(
            currentOwnerId(ctx),
            values.accountId,
            values.message,
            new Date(values.scheduledAt),
          );
        }),
        settingsList: this.action(async (ctx) => {
          const values = actionValues<{ type: SettingType }>(ctx);
          return this.settings.list(currentOwnerId(ctx), values.type);
        }),
        settingsSave: this.action(async (ctx) => {
          const values = actionValues<SettingsInput>(ctx);
          return this.settings.save(currentOwnerId(ctx), values.type, values.record);
        }),
        settingsDelete: this.action(async (ctx) => {
          const values = actionValues<{ type: SettingType; id: number }>(ctx);
          await this.settings.destroy(currentOwnerId(ctx), values.type, values.id);
          return { success: true };
        }),
        attachmentDownload: this.action(async (ctx) => {
          const attachment = await this.attachments.openOwned(
            currentOwnerId(ctx),
            Number(ctx.action.params.filterByTk),
          );
          ctx.type = attachment.contentType;
          ctx.length = attachment.size;
          ctx.attachment(attachment.filename);
          ctx.body = attachment.stream;
          return undefined;
        }),
      },
    });

    this.app.acl.allow('mailCenter', '*', 'loggedIn');
    this.app.acl.registerSnippet({ name: 'ui.mailCenter', actions: ['mailCenter:*'] });
  }

  private action(handler: ActionHandler) {
    return async (ctx: MailActionContext, next: Next) => {
      try {
        const result = await handler(ctx);
        if (result !== undefined) {
          ctx.body = result;
        }
        await next();
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'status' in error) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Mail operation failed';
        ctx.throw(400, ctx.t(message, { ns: NAMESPACE }));
      }
    };
  }

  private sanitizeAccount(account: MailAccountData) {
    const { password: _password, ...safeAccount } = account;
    return safeAccount;
  }
}

export default PluginMailCenterServer;
