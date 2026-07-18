/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailTemplates',
  title: 'Mail templates',
  filterTargetKey: 'id',
  fields: [
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId', onDelete: 'CASCADE' },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'string', name: 'subject' },
    { type: 'text', name: 'content', length: 'long' },
  ],
});
