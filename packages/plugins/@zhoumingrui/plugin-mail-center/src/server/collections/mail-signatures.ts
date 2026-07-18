/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailSignatures',
  title: 'Mail signatures',
  filterTargetKey: 'id',
  fields: [
    { type: 'bigInt', name: 'accountId', allowNull: false, unique: true },
    {
      type: 'belongsTo',
      name: 'account',
      target: 'mailAccounts',
      foreignKey: 'accountId',
      onDelete: 'CASCADE',
    },
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId', onDelete: 'CASCADE' },
    { type: 'text', name: 'content', length: 'long' },
  ],
});
