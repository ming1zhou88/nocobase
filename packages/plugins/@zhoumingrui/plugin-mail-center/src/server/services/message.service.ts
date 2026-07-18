/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import type { Model } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import type { MailAddress, OutgoingMessage } from '../types';
import { MailAccountService } from './account.service';
import { AttachmentStorageService, type AttachmentContent } from './attachment-storage.service';
import { SmtpService } from './smtp.service';

function modelData<T>(model: Model): T {
  return model.toJSON() as unknown as T;
}

function recipientAddresses(values: string[] | undefined): MailAddress[] {
  return (values || []).map((address) => ({ address }));
}

export interface MessageListOptions {
  page?: number;
  pageSize?: number;
  accountId?: number;
  box?: string;
  isRead?: boolean;
  search?: string;
}

export interface MessageMetadataInput {
  note?: string;
  isTodo?: boolean;
  labelIds?: number[];
}

export class MessageService {
  constructor(
    private readonly app: Application,
    private readonly accounts: MailAccountService,
    private readonly smtp: SmtpService,
    private readonly attachments: AttachmentStorageService,
  ) {}

  async list(ownerId: number, options: MessageListOptions) {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 20));
    const filters: Record<string, unknown>[] = [{ ownerId }];
    if (options.accountId) {
      filters.push({ accountId: options.accountId });
    }
    if (options.box) {
      filters.push({ box: options.box });
    }
    if (typeof options.isRead === 'boolean') {
      filters.push({ isRead: options.isRead });
    }
    if (options.search?.trim()) {
      const keyword = `%${options.search.trim()}%`;
      filters.push({ $or: [{ subject: { $like: keyword } }, { text: { $like: keyword } }] });
    }
    const [records, count] = await this.app.db.getRepository('mailMessages').findAndCount({
      filter: { $and: filters },
      appends: ['attachments', 'labels'],
      sort: ['-receivedAt', '-createdAt'],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      rows: records.map((record) => modelData<Record<string, unknown>>(record)),
      count,
      page,
      pageSize,
    };
  }

  async markRead(ownerId: number, ids: number[], isRead: boolean) {
    await this.app.db.getRepository('mailMessages').update({
      filter: { id: { $in: ids }, ownerId },
      values: { isRead },
    });
  }

  async move(ownerId: number, ids: number[], box: string) {
    await this.app.db.getRepository('mailMessages').update({
      filter: { id: { $in: ids }, ownerId },
      values: { box },
    });
  }

  async updateMetadata(ownerId: number, messageId: number, values: MessageMetadataInput) {
    const message = await this.app.db.getRepository('mailMessages').findOne({ filter: { id: messageId, ownerId } });
    if (!message) {
      throw new Error('Mail message not found');
    }
    await this.app.db.getRepository('mailMessages').update({
      filterByTk: messageId,
      values: { note: values.note || '', isTodo: values.isTodo ?? false },
    });
    if (values.labelIds) {
      const validLabels = await this.app.db.getRepository('mailLabels').find({
        filter: { id: { $in: values.labelIds }, ownerId },
        fields: ['id'],
      });
      await this.app.db.getRepository('mailMessageLabels').destroy({ filter: { mailMessageId: messageId } });
      if (validLabels.length) {
        await this.app.db.getRepository('mailMessageLabels').createMany({
          records: validLabels.map((label) => ({ mailMessageId: messageId, mailLabelId: Number(label.get('id')) })),
        });
      }
    }
  }

  async saveDraft(ownerId: number, accountId: number, message: OutgoingMessage) {
    const account = await this.accounts.getOwned(ownerId, accountId);
    return this.storeOutgoing(account.id, ownerId, 'draft', message, undefined, account.email);
  }

  async schedule(ownerId: number, accountId: number, message: OutgoingMessage, scheduledAt: Date) {
    if (scheduledAt.getTime() <= Date.now()) {
      throw new Error('Scheduled time must be in the future');
    }
    const account = await this.accounts.getOwned(ownerId, accountId);
    return this.storeOutgoing(account.id, ownerId, 'scheduled', message, undefined, account.email, scheduledAt);
  }

  async send(ownerId: number, accountId: number, message: OutgoingMessage) {
    const account = await this.accounts.getOwned(ownerId, accountId);
    if (!message.to.length) {
      throw new Error('At least one recipient is required');
    }
    const info = await this.smtp.send(account, message);
    return this.storeOutgoing(account.id, ownerId, 'outbox', message, info.messageId, account.email);
  }

  async sendBulk(ownerId: number, accountId: number, recipients: string[], message: Omit<OutgoingMessage, 'to'>) {
    const account = await this.accounts.getOwned(ownerId, accountId);
    const results: Array<{ recipient: string; messageId?: string; error?: string }> = [];
    for (const recipient of recipients) {
      try {
        const outgoing = { ...message, to: [recipient] };
        const info = await this.smtp.send(account, outgoing);
        await this.storeOutgoing(account.id, ownerId, 'outbox', outgoing, info.messageId, account.email);
        results.push({ recipient, messageId: info.messageId });
      } catch (error) {
        results.push({ recipient, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  async processScheduled() {
    const records = await this.app.db.getRepository('mailMessages').find({
      filter: {
        box: 'scheduled',
        scheduledAt: { $lte: new Date() },
        sendAttempts: { $lt: 3 },
      },
      sort: ['scheduledAt'],
      limit: 50,
    });
    for (const record of records) {
      const data = modelData<{
        id: number;
        accountId: number;
        to: MailAddress[];
        cc: MailAddress[];
        bcc: MailAddress[];
        subject: string;
        text: string;
        html: string;
        inReplyTo?: string;
        referenceIds?: string[];
        sendAttempts?: number;
      }>(record);
      const attempts = Number(data.sendAttempts || 0) + 1;
      try {
        const account = await this.accounts.getById(data.accountId);
        const storedAttachments = await this.attachments.readForMessage(data.id);
        const info = await this.smtp.send(account, {
          to: data.to.map((item) => item.address),
          cc: data.cc?.map((item) => item.address),
          bcc: data.bcc?.map((item) => item.address),
          subject: data.subject,
          text: data.text,
          html: data.html,
          inReplyTo: data.inReplyTo,
          references: data.referenceIds,
          attachments: storedAttachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            contentBase64: attachment.content.toString('base64'),
          })),
        });
        await this.app.db.getRepository('mailMessages').update({
          filterByTk: data.id,
          values: {
            box: 'outbox',
            messageId: info.messageId,
            sentAt: new Date(),
            sendStatus: 'sent',
            sendAttempts: attempts,
            sendError: null,
          },
        });
      } catch (error) {
        await this.app.db.getRepository('mailMessages').update({
          filterByTk: data.id,
          values: {
            sendStatus: attempts >= 3 ? 'failed' : 'retrying',
            sendAttempts: attempts,
            sendError: error instanceof Error ? error.message : String(error),
            scheduledAt: attempts >= 3 ? record.get('scheduledAt') : new Date(Date.now() + attempts * 5 * 60_000),
          },
        });
      }
    }
  }

  private async storeOutgoing(
    accountId: number,
    ownerId: number,
    box: string,
    message: OutgoingMessage,
    messageId: string | undefined,
    fromAddress: string,
    scheduledAt?: Date,
  ) {
    const now = new Date();
    const record = await this.app.db.getRepository('mailMessages').create({
      values: {
        syncKey: `local:${randomUUID()}`,
        accountId,
        ownerId,
        messageId,
        threadId: message.references?.[0] || message.inReplyTo || messageId || `local:${randomUUID()}`,
        inReplyTo: message.inReplyTo,
        referenceIds: message.references || [],
        box,
        from: [{ address: fromAddress }],
        to: recipientAddresses(message.to),
        cc: recipientAddresses(message.cc),
        bcc: recipientAddresses(message.bcc),
        subject: message.subject,
        text: message.text || '',
        html: message.html || '',
        receivedAt: now,
        sentAt: box === 'outbox' ? now : null,
        scheduledAt,
        sendStatus: box === 'scheduled' ? 'scheduled' : box === 'outbox' ? 'sent' : null,
        isRead: true,
        hasAttachments: Boolean(message.attachments?.length),
        workflowStatus: 'not-applicable',
      },
    });
    const recordId = Number(record.get('id'));
    const attachmentContent: AttachmentContent[] = (message.attachments || []).map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: Buffer.from(attachment.contentBase64, 'base64'),
    }));
    await this.attachments.save(recordId, attachmentContent);
    return modelData<Record<string, unknown>>(record);
  }
}
