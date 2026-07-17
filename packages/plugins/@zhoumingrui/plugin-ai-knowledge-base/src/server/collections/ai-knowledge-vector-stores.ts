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
  name: 'aiKnowledgeVectorStores',
  title: 'AI knowledge vector stores',
  filterTargetKey: 'id',
  fields: [
    { type: 'string', name: 'key', unique: true, allowNull: false },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'belongsTo', name: 'vectorDatabase', target: 'aiKnowledgeVectorDatabases', foreignKey: 'vectorDatabaseId' },
    { type: 'belongsTo', name: 'llmService', target: 'llmServices', foreignKey: 'llmServiceName', targetKey: 'name' },
    { type: 'string', name: 'embeddingModel', allowNull: false },
    { type: 'integer', name: 'dimensions', allowNull: false },
    { type: 'string', name: 'indexTable' },
    { type: 'datetimeTz', name: 'initializedAt' },
    { type: 'boolean', name: 'enabled', allowNull: false, defaultValue: true },
  ],
});
