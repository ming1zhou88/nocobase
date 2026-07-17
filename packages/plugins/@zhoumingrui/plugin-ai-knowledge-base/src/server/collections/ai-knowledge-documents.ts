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
