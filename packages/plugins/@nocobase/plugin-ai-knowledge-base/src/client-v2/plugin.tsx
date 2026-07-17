/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Application, Plugin } from '@nocobase/client-v2';

export class PluginAiKnowledgeBaseClientV2 extends Plugin<any, Application> {
  async load() {
    this.pluginSettingsManager.addMenuItem({
      key: 'ai-knowledge-base',
      title: this.t('AI knowledge base'),
      icon: 'DatabaseOutlined',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'ai-knowledge-base',
      key: 'vector-database',
      title: this.t('Vector database'),
      componentLoader: () => import('./pages/VectorDatabasePage'),
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'ai-knowledge-base',
      key: 'vector-store',
      title: this.t('Vector store'),
      componentLoader: () => import('./pages/VectorStorePage'),
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'ai-knowledge-base',
      key: 'knowledge-base',
      title: this.t('Knowledge base'),
      componentLoader: () => import('./pages/KnowledgeBasePage'),
    });
  }
}

export default PluginAiKnowledgeBaseClientV2;
