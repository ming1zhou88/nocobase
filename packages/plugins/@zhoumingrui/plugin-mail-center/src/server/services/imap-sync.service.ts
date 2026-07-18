/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { Model } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import type { MailAddress, MailAccountData, ReceivedMailContext } from '../types';
import { AttachmentStorageService, type AttachmentContent } from './attachment-storage.service';
import { MailAccountService } from './account.service';
import type { MailReceivedTrigger } from '../workflow/mail-received-trigger';

function modelData<T>(model: Model): T {
  return model.toJSON() as unknown as T;
}

function addresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!value) {
    return [];
  }
  const objects = Array.isArray(value) ? value : [value];
  return objects.flatMap((item) =>
    item.value.map((address) => ({ address: address.address || '', name: address.name })),
  );
}

function referenceIds(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function headerObject(parsed: ParsedMail): Record<string, string> {
  return Object.fromEntries(Array.from(parsed.headers.entries()).map(([key, value]) => [key, String(value)]));
}

function normalizedDate(value: string | Date | undefined): Date {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export interface SyncResult {
  fetchedCount: number;
  createdCount: number;
}

export class ImapSyncService {
  private readonly active = new Map<number, Promise<SyncResult>>();
  private trigger?: MailReceivedTrigger;

  constructor(
    private readonly app: Application,
    private readonly accounts: MailAccountService,
    private readonly attachments: AttachmentStorageService,
  ) {}

  setTrigger(trigger: MailReceivedTrigger) {
    this.trigger = trigger;
  }

  async verify(account: MailAccountData) {
    const client = this.createClient(account);
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      lock.release();
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  sync(account: MailAccountData): Promise<SyncResult> {
    const running = this.active.get(account.id);
    if (running) {
      return running;
    }
    const task = this.performSync(account).finally(() => {
      this.active.delete(account.id);
    });
    this.active.set(account.id, task);
    return task;
  }

  async syncDueAccounts() {
    const records = await this.app.db.getRepository('mailAccounts').find({ filter: { enabled: true } });
    const now = Date.now();
    for (const record of records) {
      const account = modelData<MailAccountData>(record);
      const lastSyncedAt = account.lastSyncedAt ? new Date(account.lastSyncedAt).getTime() : 0;
      const dueAfter = Math.max(1, account.syncIntervalMinutes || 5) * 60_000;
      if (now - lastSyncedAt < dueAfter) {
        continue;
      }
      try {
        await this.sync(account);
      } catch (error) {
        this.app.logger.error('[Mail center] scheduled mailbox synchronization failed', {
          error,
          accountId: account.id,
        });
      }
    }
  }

  private async performSync(account: MailAccountData): Promise<SyncResult> {
    const startedAt = new Date();
    const log = await this.app.db.getRepository('mailSyncLogs').create({
      values: { accountId: account.id, ownerId: account.ownerId, status: 'running', startedAt },
    });
    const logId = Number(log.get('id'));
    const client = this.createClient(account);
    let fetchedCount = 0;
    let createdCount = 0;
    let highestUid = Number(account.lastUid || 0);
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uidValidity = String(client.mailbox && client.mailbox.uidValidity ? client.mailbox.uidValidity : '0');
        if (account.uidValidity && account.uidValidity !== uidValidity) {
          highestUid = 0;
        }
        const startUid = Math.max(1, highestUid + 1);
        for await (const message of client.fetch(
          `${startUid}:*`,
          { uid: true, flags: true, internalDate: true, envelope: true, source: true },
          { uid: true },
        )) {
          fetchedCount += 1;
          highestUid = Math.max(highestUid, message.uid);
          const created = await this.persistMessage(account, uidValidity, message);
          if (created) {
            createdCount += 1;
            this.trigger?.schedule(created);
          }
        }
        await this.app.db.getRepository('mailAccounts').update({
          filterByTk: account.id,
          values: {
            lastUid: highestUid,
            uidValidity,
            lastSyncedAt: new Date(),
            status: 'ready',
            lastError: null,
          },
        });
      } finally {
        lock.release();
      }
      await this.finishLog(logId, 'success', fetchedCount, createdCount);
      return { fetchedCount, createdCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.app.db.getRepository('mailAccounts').update({
        filterByTk: account.id,
        values: { status: 'error', lastError: message },
      });
      await this.finishLog(logId, 'failed', fetchedCount, createdCount, message);
      throw error;
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private createClient(account: MailAccountData) {
    return new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: { user: account.username, pass: account.password },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000,
    });
  }

  private async finishLog(logId: number, status: string, fetchedCount: number, createdCount: number, error?: string) {
    await this.app.db.getRepository('mailSyncLogs').update({
      filterByTk: logId,
      values: { status, fetchedCount, createdCount, error, finishedAt: new Date() },
    });
  }

  private async persistMessage(
    account: MailAccountData,
    uidValidity: string,
    message: FetchMessageObject,
  ): Promise<ReceivedMailContext | null> {
    if (!message.source) {
      return null;
    }
    const syncKey = `${account.id}:${uidValidity}:${message.uid}`;
    const existing = await this.app.db.getRepository('mailMessages').findOne({ filter: { syncKey } });
    if (existing) {
      return null;
    }
    const parsed = await simpleParser(message.source);
    const from = addresses(parsed.from);
    const to = addresses(parsed.to);
    const cc = addresses(parsed.cc);
    const replyTo = addresses(parsed.replyTo);
    const references = referenceIds(parsed.references);
    const threadId = references[0] || parsed.inReplyTo || parsed.messageId || syncKey;
    const receivedAt = normalizedDate(parsed.date || message.internalDate);
    const attachmentContent: AttachmentContent[] = parsed.attachments.map((attachment) => ({
      filename: attachment.filename || 'attachment',
      contentType: attachment.contentType,
      content: attachment.content,
      contentId: attachment.contentId,
      disposition: attachment.contentDisposition,
    }));
    const record = await this.app.db.getRepository('mailMessages').create({
      values: {
        syncKey,
        accountId: account.id,
        ownerId: account.ownerId,
        messageId: parsed.messageId,
        threadId,
        inReplyTo: parsed.inReplyTo,
        referenceIds: references,
        box: 'inbox',
        uid: message.uid,
        uidValidity,
        from,
        to,
        cc,
        replyTo,
        subject: parsed.subject || '',
        text: parsed.text || '',
        html: typeof parsed.html === 'string' ? parsed.html : '',
        receivedAt,
        sentAt: parsed.date,
        isRead: message.flags?.has('\\Seen') || false,
        isFlagged: message.flags?.has('\\Flagged') || false,
        hasAttachments: attachmentContent.length > 0,
        headers: headerObject(parsed),
        workflowStatus: 'pending',
      },
    });
    const messageRecordId = Number(record.get('id'));
    const storedAttachments = await this.attachments.save(messageRecordId, attachmentContent);
    return {
      id: messageRecordId,
      accountId: account.id,
      ownerId: account.ownerId,
      mailbox: 'inbox',
      messageId: parsed.messageId,
      threadId,
      inReplyTo: parsed.inReplyTo,
      from,
      to,
      cc,
      replyTo,
      subject: parsed.subject || '',
      text: parsed.text || '',
      html: typeof parsed.html === 'string' ? parsed.html : '',
      receivedAt: receivedAt.toISOString(),
      isRead: message.flags?.has('\\Seen') || false,
      hasAttachments: storedAttachments.length > 0,
      attachments: storedAttachments,
    };
  }
}
