/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
