/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Context } from '@nocobase/actions';

export type ConnectorType = 'mysql' | 'postgres' | 'nocobase';

export type CollectionSelection =
  | string
  | {
      name: string;
      schema?: string;
    };

export interface ConnectorOptions {
  name?: string;
  type?: ConnectorType;
  enabled?: boolean;
  readOnly?: boolean;
  addAllCollections?: boolean;
  collections?: CollectionSelection[];
  databaseInstance?: unknown;
}

export interface SqlConnectorOptions extends ConnectorOptions {
  host: string;
  port?: number | string;
  database: string;
  username: string;
  password?: string;
  tablePrefix?: string;
  schema?: string;
  connectionTimeoutMs?: number;
  poolMax?: number;
  ssl?: {
    sslMode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
}

export interface NocoBaseConnectorOptions extends ConnectorOptions {
  baseUrl: string;
  apiPath?: string;
  apiToken: string;
  dataSourceKey?: string;
  roleName?: string;
  requestTimeoutMs?: number;
}

export interface DataSourceMutationContext extends Context {
  action: Context['action'] & {
    params: Context['action']['params'] & {
      values?: {
        options?: ConnectorOptions;
      };
    };
  };
}

export interface RemoteCollectionMetadata {
  name: string;
  title?: string;
  tableName?: string;
  filterTargetKey?: string | string[];
  fields?: RemoteFieldMetadata[];
  [key: string]: unknown;
}

export interface RemoteFieldMetadata {
  name: string;
  field?: string;
  type?: string;
  interface?: string;
  rawType?: string;
  uiSchema?: Record<string, unknown>;
  [key: string]: unknown;
}
