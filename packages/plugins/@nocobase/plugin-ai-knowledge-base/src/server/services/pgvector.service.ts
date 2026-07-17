/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Client } from 'pg';
import type { PgVectorConnection } from '../types';

export type PgVectorConnectionCheck = {
  connected: boolean;
  extensionVersion?: string;
  error?: string;
};

export async function checkPgVectorConnection(connection: PgVectorConnection): Promise<PgVectorConnectionCheck> {
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    // noinspection SqlNoDataSourceInspection
    const result = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    const extensionVersion = result.rows[0]?.extversion;
    if (!extensionVersion) {
      return { connected: false, error: 'The vector extension is not enabled in this database.' };
    }
    return { connected: true, extensionVersion };
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : 'Connection failed.' };
  } finally {
    await client.end().catch(() => undefined);
  }
}
