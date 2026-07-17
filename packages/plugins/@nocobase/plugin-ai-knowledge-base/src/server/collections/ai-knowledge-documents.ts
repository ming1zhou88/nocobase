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
  name: 'aiKnowledgeDocuments',
  title: 'AI knowledge documents',
  fields: [
    { type: 'belongsTo', name: 'knowledgeBase', target: 'aiKnowledgeBases', foreignKey: 'knowledgeBaseId' },
    { type: 'string', name: 'sourceType', allowNull: false, defaultValue: 'text' },
    { type: 'string', name: 'sourceId', allowNull: false },
    { type: 'string', name: 'title', allowNull: false },
    { type: 'text', name: 'content', allowNull: false },
    { type: 'integer', name: 'chunkCount', allowNull: false, defaultValue: 0 },
    { type: 'string', name: 'status', allowNull: false, defaultValue: 'pending' },
    { type: 'text', name: 'error' },
  ],
});
