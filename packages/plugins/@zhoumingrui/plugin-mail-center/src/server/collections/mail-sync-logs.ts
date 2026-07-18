/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailSyncLogs',
  title: 'Mail synchronization logs',
  filterTargetKey: 'id',
  fields: [
    { type: 'bigInt', name: 'accountId', allowNull: false, index: true },
    {
      type: 'belongsTo',
      name: 'account',
      target: 'mailAccounts',
      foreignKey: 'accountId',
      onDelete: 'CASCADE',
    },
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'string', name: 'status', allowNull: false },
    { type: 'integer', name: 'fetchedCount', defaultValue: 0 },
    { type: 'integer', name: 'createdCount', defaultValue: 0 },
    { type: 'date', name: 'startedAt', allowNull: false },
    { type: 'date', name: 'finishedAt' },
    { type: 'text', name: 'error' },
  ],
});
