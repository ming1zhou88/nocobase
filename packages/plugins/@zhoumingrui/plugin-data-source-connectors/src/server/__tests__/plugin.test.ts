/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NocoBaseDataSource } from '../nocobase-data-source';
import { PluginDataSourceConnectorsServer } from '../plugin';
import { MySQLDataSource, PostgreSQLDataSource } from '../sql-data-source';

describe('data source connector plugin', () => {
  it('registers the initial connector types', async () => {
    const registerDataSourceType = vi.fn();
    const plugin = Object.create(PluginDataSourceConnectorsServer.prototype) as PluginDataSourceConnectorsServer;
    Object.defineProperty(plugin, 'app', {
      value: {
        dataSourceManager: {
          registerDataSourceType,
        },
      },
    });

    await plugin.beforeLoad();

    expect(registerDataSourceType).toHaveBeenNthCalledWith(1, 'mysql', MySQLDataSource);
    expect(registerDataSourceType).toHaveBeenNthCalledWith(2, 'postgres', PostgreSQLDataSource);
    expect(registerDataSourceType).toHaveBeenNthCalledWith(3, 'nocobase', NocoBaseDataSource);
  });
});
