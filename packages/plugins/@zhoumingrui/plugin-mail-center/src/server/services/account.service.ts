/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Model, Repository } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import type { MailAccountData } from '../types';
import { CredentialCipherService } from './credential-cipher.service';

export interface MailAccountInput {
  id?: number;
  name: string;
  email: string;
  senderName?: string;
  enabled?: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
  username: string;
  password?: string;
  syncIntervalMinutes?: number;
}

function modelData<T>(model: Model): T {
  return model.toJSON() as unknown as T;
}

export class MailAccountService {
  private readonly credentialCipher: CredentialCipherService;

  constructor(private readonly app: Application) {
    this.credentialCipher = new CredentialCipherService(app.aesEncryptor);
  }

  private repository(): Repository {
    return this.app.db.getRepository('mailAccounts');
  }

  async list(ownerId: number) {
    const records = await this.repository().find({
      filter: { ownerId },
      sort: ['email'],
      except: ['password'],
    });
    return records.map((record) => modelData<Record<string, unknown>>(record));
  }

  async getOwned(ownerId: number, accountId: number): Promise<MailAccountData> {
    const record = await this.findOwned(ownerId, accountId);
    return this.decryptCredential(modelData<MailAccountData>(record));
  }

  async getById(accountId: number): Promise<MailAccountData> {
    const record = await this.repository().findOne({ filterByTk: accountId });
    if (!record) {
      throw new Error('Mail account not found');
    }
    return this.decryptCredential(modelData<MailAccountData>(record));
  }

  async save(ownerId: number, values: MailAccountInput) {
    const normalizedEmail = values.email.trim().toLocaleLowerCase();
    const accountKey = `${ownerId}:${normalizedEmail}`;
    const writableValues: Record<string, unknown> = {
      accountKey,
      ownerId,
      name: values.name.trim(),
      email: normalizedEmail,
      senderName: values.senderName?.trim(),
      enabled: values.enabled ?? true,
      imapHost: values.imapHost.trim(),
      imapPort: values.imapPort,
      imapSecure: values.imapSecure ?? true,
      smtpHost: values.smtpHost.trim(),
      smtpPort: values.smtpPort,
      smtpSecure: values.smtpSecure ?? true,
      username: values.username.trim(),
      syncIntervalMinutes: Math.max(1, values.syncIntervalMinutes || 5),
      status: 'pending',
      lastError: null,
    };
    if (values.password) {
      writableValues.password = await this.credentialCipher.encrypt(values.password);
    }

    if (values.id) {
      await this.findOwned(ownerId, values.id);
      await this.repository().update({ filterByTk: values.id, values: writableValues });
      return this.getOwned(ownerId, values.id);
    }
    if (!values.password) {
      throw new Error('Password is required');
    }
    const created = await this.repository().create({ values: writableValues });
    return this.decryptCredential(modelData<MailAccountData>(created));
  }

  async destroy(ownerId: number, accountId: number) {
    await this.findOwned(ownerId, accountId);
    await this.repository().destroy({ filterByTk: accountId });
  }

  private async findOwned(ownerId: number, accountId: number): Promise<Model> {
    const record = await this.repository().findOne({ filter: { id: accountId, ownerId } });
    if (!record) {
      throw new Error('Mail account not found');
    }
    return record;
  }

  private async decryptCredential(account: MailAccountData): Promise<MailAccountData> {
    return {
      ...account,
      password: await this.credentialCipher.decrypt(account.password),
    };
  }
}
