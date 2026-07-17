/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Plugin } from '@nocobase/client';
import PluginDataSourceManagerClient from '@nocobase/plugin-data-source-manager/client';
import { MySQLLegacySettingsForm, NocoBaseLegacySettingsForm, PostgreSQLLegacySettingsForm } from './forms';
import { tExpr } from './locale';

export class PluginDataSourceConnectorsClient extends Plugin {
  async load() {
    const manager = this.app.pm.get(PluginDataSourceManagerClient);
    if (!manager) {
      throw new Error('@nocobase/plugin-data-source-manager is required');
    }
    manager.registerType('mysql', {
      name: 'mysql',
      label: tExpr('MySQL'),
      DataSourceSettingsForm: MySQLLegacySettingsForm,
    });
    manager.registerType('postgres', {
      name: 'postgres',
      label: tExpr('PostgreSQL'),
      DataSourceSettingsForm: PostgreSQLLegacySettingsForm,
    });
    manager.registerType('nocobase', {
      name: 'nocobase',
      label: tExpr('NocoBase'),
      DataSourceSettingsForm: NocoBaseLegacySettingsForm,
      disableConfigureFields: true,
    });
  }
}

export default PluginDataSourceConnectorsClient;
