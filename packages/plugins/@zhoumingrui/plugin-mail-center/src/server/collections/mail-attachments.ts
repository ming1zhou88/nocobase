/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailAttachments',
  title: 'Mail attachments',
  filterTargetKey: 'id',
  fields: [
    { type: 'bigInt', name: 'messageRecordId', allowNull: false, index: true },
    {
      type: 'belongsTo',
      name: 'message',
      target: 'mailMessages',
      foreignKey: 'messageRecordId',
      onDelete: 'CASCADE',
    },
    { type: 'string', name: 'filename', allowNull: false },
    { type: 'string', name: 'contentType' },
    { type: 'bigInt', name: 'size', defaultValue: 0 },
    { type: 'string', name: 'contentId' },
    { type: 'string', name: 'disposition' },
    { type: 'string', name: 'storagePath', allowNull: false, hidden: true },
  ],
});
