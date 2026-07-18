/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailMessages',
  title: 'Mail messages',
  filterTargetKey: 'id',
  fields: [
    { type: 'string', name: 'syncKey', allowNull: false, unique: true, hidden: true },
    { type: 'bigInt', name: 'accountId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'account', target: 'mailAccounts', foreignKey: 'accountId', onDelete: 'CASCADE' },
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId', onDelete: 'CASCADE' },
    { type: 'string', name: 'messageId', index: true },
    { type: 'string', name: 'threadId', index: true },
    { type: 'string', name: 'inReplyTo' },
    { type: 'json', name: 'referenceIds' },
    { type: 'string', name: 'box', allowNull: false, defaultValue: 'inbox', index: true },
    { type: 'bigInt', name: 'uid' },
    { type: 'string', name: 'uidValidity' },
    { type: 'json', name: 'from' },
    { type: 'json', name: 'to' },
    { type: 'json', name: 'cc' },
    { type: 'json', name: 'bcc' },
    { type: 'json', name: 'replyTo' },
    { type: 'string', name: 'subject' },
    { type: 'text', name: 'text' },
    { type: 'text', name: 'html', length: 'long' },
    { type: 'date', name: 'receivedAt', index: true },
    { type: 'date', name: 'sentAt' },
    { type: 'date', name: 'scheduledAt', index: true },
    { type: 'string', name: 'sendStatus' },
    { type: 'integer', name: 'sendAttempts', defaultValue: 0 },
    { type: 'text', name: 'sendError' },
    { type: 'boolean', name: 'isRead', defaultValue: false, index: true },
    { type: 'boolean', name: 'isFlagged', defaultValue: false },
    { type: 'boolean', name: 'isTodo', defaultValue: false },
    { type: 'boolean', name: 'hasAttachments', defaultValue: false },
    { type: 'text', name: 'note' },
    { type: 'json', name: 'headers' },
    { type: 'string', name: 'workflowStatus', defaultValue: 'pending' },
    { type: 'text', name: 'workflowError' },
    { type: 'hasMany', name: 'attachments', target: 'mailAttachments', foreignKey: 'messageRecordId' },
    { type: 'belongsToMany', name: 'labels', target: 'mailLabels', through: 'mailMessageLabels' },
  ],
});
