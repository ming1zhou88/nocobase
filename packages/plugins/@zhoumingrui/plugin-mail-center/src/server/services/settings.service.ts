/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Model } from '@nocobase/database';
import type { Application } from '@nocobase/server';
import { MailAccountService } from './account.service';

export type SettingType = 'labels' | 'templates' | 'signatures';

const COLLECTIONS: Record<SettingType, string> = {
  labels: 'mailLabels',
  templates: 'mailTemplates',
  signatures: 'mailSignatures',
};

function modelData<T>(model: Model): T {
  return model.toJSON() as unknown as T;
}

export class SettingsService {
  constructor(
    private readonly app: Application,
    private readonly accounts: MailAccountService,
  ) {}

  async list(ownerId: number, type: SettingType) {
    const records = await this.app.db.getRepository(COLLECTIONS[type]).find({
      filter: { ownerId },
      sort: ['-updatedAt'],
      appends: type === 'signatures' ? ['account'] : [],
    });
    return records.map((record) => modelData<Record<string, unknown>>(record));
  }

  async save(ownerId: number, type: SettingType, input: Record<string, unknown>) {
    const id = input.id ? Number(input.id) : undefined;
    const values = this.allowedValues(type, input);
    values.ownerId = ownerId;
    if (type === 'signatures') {
      const accountId = Number(values.accountId);
      await this.accounts.getOwned(ownerId, accountId);
      values.accountId = accountId;
    }
    const repository = this.app.db.getRepository(COLLECTIONS[type]);
    if (id) {
      const existing = await repository.findOne({ filter: { id, ownerId } });
      if (!existing) {
        throw new Error('Setting record not found');
      }
      await repository.update({ filterByTk: id, values });
      const updated = await repository.findOne({ filterByTk: id });
      return updated ? modelData<Record<string, unknown>>(updated) : null;
    }
    const created = await repository.create({ values });
    return modelData<Record<string, unknown>>(created);
  }

  async destroy(ownerId: number, type: SettingType, id: number) {
    await this.app.db.getRepository(COLLECTIONS[type]).destroy({ filter: { id, ownerId } });
  }

  private allowedValues(type: SettingType, input: Record<string, unknown>): Record<string, unknown> {
    if (type === 'labels') {
      return { name: String(input.name || '').trim(), color: String(input.color || 'blue') };
    }
    if (type === 'templates') {
      return {
        name: String(input.name || '').trim(),
        subject: String(input.subject || ''),
        content: String(input.content || ''),
      };
    }
    return { accountId: Number(input.accountId), content: String(input.content || '') };
  }
}
