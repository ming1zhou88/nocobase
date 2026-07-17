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
