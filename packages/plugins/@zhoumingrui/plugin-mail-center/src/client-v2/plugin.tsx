/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Application, Plugin } from '@nocobase/client-v2';

export class PluginMailCenterClientV2 extends Plugin<unknown, Application> {
  async load() {
    this.pluginSettingsManager.addMenuItem({
      key: 'mail-center',
      title: this.t('Mail Center'),
      icon: 'MailOutlined',
    });
    this.pluginSettingsManager.addPageTabItem({
      menuKey: 'mail-center',
      key: 'index',
      title: this.t('Mail Center'),
      componentLoader: () => import('./pages/MailCenterPage'),
    });
    this.router.add('mail-center', {
      path: '/mail/manager',
      componentLoader: () => import('./pages/MailCenterPage'),
    });
  }
}

export default PluginMailCenterClientV2;
