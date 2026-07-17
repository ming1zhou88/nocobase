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
