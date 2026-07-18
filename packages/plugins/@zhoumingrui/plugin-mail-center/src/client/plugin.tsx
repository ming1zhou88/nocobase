/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React from 'react';
import { Plugin } from '@nocobase/client';
import WorkflowPlugin from '@nocobase/plugin-workflow/client';
import { MailCenterPage } from './pages/MailCenterPage';
import MailReceivedWorkflowTrigger from './workflow/MailReceivedTrigger';
import { NAMESPACE, tExpr } from './locale';

export class PluginMailCenterClient extends Plugin {
  async load() {
    this.app.router.add('admin.mail-center', {
      path: '/admin/mail/manager',
      Component: MailCenterPage,
    });
    this.app.pluginSettingsManager.add(NAMESPACE, {
      title: tExpr('Mail Center'),
      icon: 'MailOutlined',
      Component: MailCenterPage,
      aclSnippet: 'ui.mailCenter',
    });
    const workflow = this.app.pm.get('workflow') as WorkflowPlugin;
    workflow.registerTrigger('mail-received', MailReceivedWorkflowTrigger);
  }
}

export default PluginMailCenterClient;
