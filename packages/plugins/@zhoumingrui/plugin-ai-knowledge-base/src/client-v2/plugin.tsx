/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
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
