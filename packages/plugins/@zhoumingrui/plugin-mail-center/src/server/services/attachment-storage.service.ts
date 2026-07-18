/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Model } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import type { StoredAttachmentContext } from '../types';

export interface AttachmentContent {
  filename: string;
  contentType?: string;
  content: Buffer;
  contentId?: string;
  disposition?: string;
}

export interface OwnedAttachment {
  filename: string;
  contentType: string;
  size: number;
  stream: ReturnType<typeof createReadStream>;
}

function modelData<T>(model: Model): T {
  return model.toJSON() as unknown as T;
}

function safeFilename(filename: string): string {
  const normalized = path.basename(filename || 'attachment').replace(/[^\p{L}\p{N}._-]+/gu, '_');
  return normalized.slice(-180) || 'attachment';
}

export class AttachmentStorageService {
  private readonly root = path.resolve(process.cwd(), 'storage', 'mail-center');

  constructor(private readonly app: Application) {}

  async save(messageRecordId: number, attachments: AttachmentContent[]): Promise<StoredAttachmentContext[]> {
    if (!attachments.length) {
      return [];
    }
    const messageDirectory = path.resolve(this.root, String(messageRecordId));
    if (!messageDirectory.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid attachment directory');
    }
    await mkdir(messageDirectory, { recursive: true });
    const created: StoredAttachmentContext[] = [];
    try {
      for (const attachment of attachments) {
        const filename = safeFilename(attachment.filename);
        const storagePath = path.resolve(messageDirectory, `${randomUUID()}-${filename}`);
        await writeFile(storagePath, attachment.content, { flag: 'wx' });
        const model = await this.app.db.getRepository('mailAttachments').create({
          values: {
            messageRecordId,
            filename,
            contentType: attachment.contentType || 'application/octet-stream',
            size: attachment.content.length,
            contentId: attachment.contentId,
            disposition: attachment.disposition,
            storagePath,
          },
        });
        const data = modelData<{ id: number; filename: string; contentType?: string; size: number }>(model);
        created.push(data);
      }
      return created;
    } catch (error) {
      await rm(messageDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  async openOwned(ownerId: number, attachmentId: number): Promise<OwnedAttachment> {
    const attachment = await this.app.db.getRepository('mailAttachments').findOne({ filterByTk: attachmentId });
    if (!attachment) {
      throw new Error('Attachment not found');
    }
    const attachmentData = modelData<{
      messageRecordId: number;
      filename: string;
      contentType?: string;
      size: number;
      storagePath: string;
    }>(attachment);
    const message = await this.app.db.getRepository('mailMessages').findOne({
      filter: { id: attachmentData.messageRecordId, ownerId },
    });
    if (!message) {
      throw new Error('Attachment not found');
    }
    const resolvedPath = path.resolve(attachmentData.storagePath);
    if (!resolvedPath.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid attachment path');
    }
    return {
      filename: attachmentData.filename,
      contentType: attachmentData.contentType || 'application/octet-stream',
      size: attachmentData.size,
      stream: createReadStream(resolvedPath),
    };
  }

  async readForMessage(messageRecordId: number): Promise<AttachmentContent[]> {
    const records = await this.app.db.getRepository('mailAttachments').find({ filter: { messageRecordId } });
    const attachments: AttachmentContent[] = [];
    for (const record of records) {
      const data = modelData<{
        filename: string;
        contentType?: string;
        contentId?: string;
        disposition?: string;
        storagePath: string;
      }>(record);
      const resolvedPath = path.resolve(data.storagePath);
      if (!resolvedPath.startsWith(`${this.root}${path.sep}`)) {
        throw new Error('Invalid attachment path');
      }
      attachments.push({ ...data, content: await readFile(resolvedPath) });
    }
    return attachments;
  }
}
