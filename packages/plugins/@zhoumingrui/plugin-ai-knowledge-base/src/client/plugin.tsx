/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import { Plugin } from '@nocobase/client';
import models from './models';
import { lazy } from '@nocobase/client';
import { tval } from '@nocobase/utils/client';
import { namespace } from './locale';

const { KnowledgeBaseEntry } = lazy(() => import('./settings/KnowledgeBaseEntry'), 'KnowledgeBaseEntry');
const { VectorDatabaseEntry } = lazy(() => import('./settings/VectorDatabaseEntry'), 'VectorDatabaseEntry');
const { VectorStoreEntry } = lazy(() => import('./settings/VectorStoreEntry'), 'VectorStoreEntry');

export class PluginAiKnowledgeBaseClient extends Plugin {
  async load() {
    this.flowEngine.registerModels(models);
    this.app.pluginSettingsManager.add('ai.vector-database', {
      icon: 'DatabaseOutlined',
      title: tval('Vector database', { ns: namespace }),
      Component: VectorDatabaseEntry,
    });
    this.app.pluginSettingsManager.add('ai.vector-store', {
      icon: 'ClusterOutlined',
      title: tval('Vector store', { ns: namespace }),
      Component: VectorStoreEntry,
    });
    this.app.pluginSettingsManager.add('ai.knowledge-base', {
      icon: 'BookOutlined',
      title: tval('Knowledge base', { ns: namespace }),
      Component: KnowledgeBaseEntry,
    });
  }
}

export default PluginAiKnowledgeBaseClient;
