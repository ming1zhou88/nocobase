/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailLabels',
  title: 'Mail labels',
  filterTargetKey: 'id',
  fields: [
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId', onDelete: 'CASCADE' },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'string', name: 'color', defaultValue: 'blue' },
    { type: 'belongsToMany', name: 'messages', target: 'mailMessages', through: 'mailMessageLabels' },
  ],
});
