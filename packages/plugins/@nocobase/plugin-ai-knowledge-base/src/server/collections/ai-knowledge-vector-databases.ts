/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'aiKnowledgeVectorDatabases',
  title: 'AI knowledge vector databases',
  filterTargetKey: 'id',
  fields: [
    { type: 'string', name: 'key', unique: true, allowNull: false },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'string', name: 'provider', allowNull: false, defaultValue: 'pgvector' },
    { type: 'string', name: 'host', allowNull: false, defaultValue: '127.0.0.1' },
    { type: 'integer', name: 'port', allowNull: false, defaultValue: 5432 },
    { type: 'string', name: 'database', allowNull: false, defaultValue: 'nocobase_kb' },
    { type: 'string', name: 'username', allowNull: false, defaultValue: 'postgres' },
    { type: 'boolean', name: 'enabled', allowNull: false, defaultValue: true },
  ],
});
