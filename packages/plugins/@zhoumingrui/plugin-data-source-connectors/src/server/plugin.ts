/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Plugin } from '@nocobase/server';
import { NocoBaseDataSource } from './nocobase-data-source';
import { MySQLDataSource, PostgreSQLDataSource } from './sql-data-source';

export class PluginDataSourceConnectorsServer extends Plugin {
  async beforeLoad() {
    this.app.dataSourceManager.registerDataSourceType('mysql', MySQLDataSource);
    this.app.dataSourceManager.registerDataSourceType('postgres', PostgreSQLDataSource);
    this.app.dataSourceManager.registerDataSourceType('nocobase', NocoBaseDataSource);
  }
}

export default PluginDataSourceConnectorsServer;
