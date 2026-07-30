/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Application, Plugin } from '@nocobase/client-v2';
import PluginDataSourceManagerClientV2 from '@nocobase/plugin-data-source-manager/client-v2';
import { MySQLSettingsForm, NocoBaseSettingsForm, PostgreSQLSettingsForm } from './forms';
import { normalizeConnectorValues } from './normalize-values';

export class PluginDataSourceConnectorsClientV2 extends Plugin<unknown, Application> {
  async load() {
    const manager = this.app.pm.get(PluginDataSourceManagerClientV2);
    if (!manager) {
      throw new Error('@nocobase/plugin-data-source-manager is required');
    }

    manager.registerType('mysql', {
      label: String(this.t('MySQL')),
      defaultValues: {
        type: 'mysql',
        enabled: true,
        options: {
          port: 3306,
          addAllCollections: true,
          readOnly: false,
          connectionTimeoutMs: 10_000,
          poolMax: 10,
        },
      },
      SettingsForm: MySQLSettingsForm,
      normalizeValues: normalizeConnectorValues,
      allowCollectionCreate: true,
      allowCollectionDeletion: true,
      allowPhysicalFieldCreate: true,
    });
    manager.registerType('postgres', {
      label: String(this.t('PostgreSQL')),
      defaultValues: {
        type: 'postgres',
        enabled: true,
        options: {
          port: 5432,
          schema: 'public',
          ssl: { sslMode: 'disable' },
          addAllCollections: true,
          readOnly: false,
          connectionTimeoutMs: 10_000,
          poolMax: 10,
        },
      },
      SettingsForm: PostgreSQLSettingsForm,
      normalizeValues: normalizeConnectorValues,
      allowCollectionCreate: true,
      allowCollectionDeletion: true,
      allowPhysicalFieldCreate: true,
    });
    manager.registerType('nocobase', {
      label: String(this.t('NocoBase')),
      defaultValues: {
        type: 'nocobase',
        enabled: true,
        options: {
          apiPath: '/api',
          dataSourceKey: 'main',
          requestTimeoutMs: 15_000,
          addAllCollections: true,
          readOnly: true,
        },
      },
      SettingsForm: NocoBaseSettingsForm,
      normalizeValues: normalizeConnectorValues,
      disableConfigureFields: true,
      allowCollectionCreate: true,
      allowCollectionDeletion: true,
    });
  }
}

export default PluginDataSourceConnectorsClientV2;
