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
  name: 'aiKnowledgeBases',
  title: 'AI knowledge bases',
  filterTargetKey: 'id',
  fields: [
    { type: 'string', name: 'key', unique: true, allowNull: false },
    { type: 'string', name: 'name', allowNull: false },
    { type: 'text', name: 'description' },
    { type: 'belongsTo', name: 'vectorStore', target: 'aiKnowledgeVectorStores', foreignKey: 'vectorStoreId' },
    { type: 'integer', name: 'topK', allowNull: false, defaultValue: 5 },
    { type: 'boolean', name: 'enabled', allowNull: false, defaultValue: true },
  ],
});
