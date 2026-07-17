/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
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
