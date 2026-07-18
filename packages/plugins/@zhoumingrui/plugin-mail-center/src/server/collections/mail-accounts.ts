/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailAccounts',
  title: 'Mail accounts',
  filterTargetKey: 'id',
  fields: [
    { type: 'string', name: 'accountKey', allowNull: false, unique: true, hidden: true },
    { type: 'bigInt', name: 'ownerId', allowNull: false, index: true },
    { type: 'belongsTo', name: 'owner', target: 'users', foreignKey: 'ownerId', onDelete: 'CASCADE' },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'string', name: 'email', allowNull: false },
    { type: 'string', name: 'senderName' },
    { type: 'boolean', name: 'enabled', defaultValue: true },
    { type: 'string', name: 'imapHost', allowNull: false },
    { type: 'integer', name: 'imapPort', allowNull: false, defaultValue: 993 },
    { type: 'boolean', name: 'imapSecure', defaultValue: true },
    { type: 'string', name: 'smtpHost', allowNull: false },
    { type: 'integer', name: 'smtpPort', allowNull: false, defaultValue: 465 },
    { type: 'boolean', name: 'smtpSecure', defaultValue: true },
    { type: 'string', name: 'username', allowNull: false },
    // The free edition does not register the optional `encryption` field type.
    // MailAccountService encrypts this value before it reaches the repository.
    { type: 'text', name: 'password', allowNull: false, hidden: true },
    { type: 'integer', name: 'syncIntervalMinutes', defaultValue: 5 },
    { type: 'bigInt', name: 'lastUid', defaultValue: 0 },
    { type: 'string', name: 'uidValidity' },
    { type: 'date', name: 'lastSyncedAt' },
    { type: 'string', name: 'status', defaultValue: 'pending' },
    { type: 'text', name: 'lastError' },
    { type: 'hasMany', name: 'messages', target: 'mailMessages', foreignKey: 'accountId' },
  ],
});
