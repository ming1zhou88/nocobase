/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Context } from '@nocobase/actions';
import { Database, type DatabaseOptions } from '@nocobase/database';
import {
  DatabaseDataSource,
  SequelizeCollectionManager,
  type CollectionOptions,
  type tableInfo,
} from '@nocobase/data-source-manager';
import type { ConnectorType, DataSourceMutationContext, SqlConnectorOptions } from './types';
import {
  MUTATING_ACTIONS,
  getErrorMessage,
  isReadOnly,
  isTransientDataSource,
  normalizeCollectionSelection,
  normalizePositiveInteger,
  saveSelectedCollections,
} from './utils';

type SqlDialect = Extract<ConnectorType, 'mysql' | 'postgres'>;

function buildSslOptions(options: SqlConnectorOptions) {
  const sslMode = options.ssl?.sslMode || 'disable';
  if (sslMode === 'disable') {
    return undefined;
  }
  return {
    rejectUnauthorized: options.ssl?.rejectUnauthorized ?? (sslMode === 'verify-ca' || sslMode === 'verify-full'),
    ...(options.ssl?.ca ? { ca: options.ssl.ca } : {}),
    ...(options.ssl?.cert ? { cert: options.ssl.cert } : {}),
    ...(options.ssl?.key ? { key: options.ssl.key } : {}),
  };
}

export function createSqlDatabaseOptions(dialect: SqlDialect, options: SqlConnectorOptions): DatabaseOptions {
  const connectionTimeoutMs = normalizePositiveInteger(options.connectionTimeoutMs, 10_000, 120_000);
  const poolMax = normalizePositiveInteger(options.poolMax, 10, 50);
  const databaseInstance = options.databaseInstance;
  if (databaseInstance instanceof Database) {
    return { database: databaseInstance } as unknown as DatabaseOptions;
  }

  const ssl = buildSslOptions(options);
  return {
    dialect,
    host: options.host,
    port: options.port ? Number(options.port) : dialect === 'mysql' ? 3306 : 5432,
    database: options.database,
    username: options.username,
    password: options.password,
    schema: dialect === 'postgres' ? options.schema || 'public' : undefined,
    tablePrefix: options.tablePrefix || '',
    pool: {
      min: 0,
      max: poolMax,
      acquire: connectionTimeoutMs,
      idle: 10_000,
    },
    dialectOptions: {
      connectTimeout: connectionTimeoutMs,
      connectionTimeoutMillis: connectionTimeoutMs,
      ...(ssl ? { ssl } : {}),
    },
  } as DatabaseOptions;
}

function normalizeTableInfo(value: unknown, defaultSchema?: string): tableInfo {
  if (typeof value === 'string') {
    return { tableName: value, schema: defaultSchema };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const tableName = record.tableName || record.name;
    if (typeof tableName === 'string') {
      return {
        tableName,
        schema: typeof record.schema === 'string' ? record.schema : defaultSchema,
      };
    }
  }
  throw new Error('The remote database returned an invalid table definition');
}

export abstract class SqlDataSource extends DatabaseDataSource {
  declare collectionManager: SequelizeCollectionManager;
  protected readonly dialect: SqlDialect;
  declare options: SqlConnectorOptions & { name: string };

  constructor(dialect: SqlDialect, options: SqlConnectorOptions) {
    const databaseOptions = createSqlDatabaseOptions(dialect, options);
    super({
      ...options,
      collectionManager: databaseOptions,
    });
    this.dialect = dialect;
    this.introspector = this.createDatabaseIntrospector(this.collectionManager.db);
    this.installReadOnlyGuard();
  }

  createCollectionManager(options?: { collectionManager?: DatabaseOptions }) {
    return new SequelizeCollectionManager(options?.collectionManager || {});
  }

  protected installReadOnlyGuard() {
    this.resourceManager.use(async (ctx, next) => {
      if (isReadOnly(this.options) && MUTATING_ACTIONS.has(ctx.action?.actionName)) {
        ctx.throw(403, 'This external data source is configured as read-only');
      }
      await next();
    });
  }

  protected async authenticate() {
    await this.collectionManager.db.sequelize.authenticate();
  }

  protected async listTableInfos() {
    await this.authenticate();
    const values = await this.introspector.getTables();
    const defaultSchema = this.dialect === 'postgres' ? this.options.schema || 'public' : undefined;
    return values.map((value) => normalizeTableInfo(value, defaultSchema));
  }

  async readTables() {
    try {
      const tables = await this.listTableInfos();
      return tables.map((table) => ({
        name: table.tableName,
        ...(table.schema ? { schema: table.schema } : {}),
      }));
    } finally {
      if (isTransientDataSource(this)) {
        await this.close();
      }
    }
  }

  async loadTables(ctx: Context, tables: string[]) {
    try {
      const availableTables = await this.listTableInfos();
      const availableNames = new Set(availableTables.map((table) => table.tableName));
      const invalidTables = tables.filter((table) => !availableNames.has(table));
      if (invalidTables.length) {
        throw new Error(`Unknown remote collections: ${invalidTables.join(', ')}`);
      }
      saveSelectedCollections(ctx as DataSourceMutationContext, tables);
    } finally {
      if (isTransientDataSource(this)) {
        await this.close();
      }
    }
  }

  async load(loadOptions: { localData?: Record<string, CollectionOptions> } = {}) {
    await this.authenticate();
    const availableTables = await this.listTableInfos();
    const selectedTables = this.options.addAllCollections
      ? availableTables
      : (this.options.collections || []).map((selection) => {
          const normalized = normalizeCollectionSelection(selection);
          return {
            tableName: normalized.name,
            schema: normalized.schema || (this.dialect === 'postgres' ? this.options.schema || 'public' : undefined),
          };
        });

    const availableByIdentity = new Map(
      availableTables.map((table) => [`${table.schema || ''}.${table.tableName}`, table]),
    );
    const resolvedTables = selectedTables.map((table) => {
      const identity = `${table.schema || ''}.${table.tableName}`;
      const resolved = availableByIdentity.get(identity);
      if (!resolved) {
        throw new Error(`Remote collection does not exist: ${table.tableName}`);
      }
      return resolved;
    });

    const collections: CollectionOptions[] = [];
    for (let index = 0; index < resolvedTables.length; index += 1) {
      const table = resolvedTables[index];
      const collection = await this.introspector.getCollection({ tableInfo: table });
      collections.push({
        ...collection,
        introspected: true,
        uiManageable: false,
      });
      this.emitLoadingProgress({ total: resolvedTables.length, loaded: index + 1 });
    }

    const mergedCollections = this.mergeWithLoadedCollections(collections, loadOptions.localData || {});
    for (const collection of mergedCollections) {
      this.collectionManager.defineCollection(collection);
    }
  }

  async cleanCache() {
    const db = this.collectionManager.db;
    for (const collection of [...db.collections.values()]) {
      db.removeCollection(collection.name);
    }
  }

  async close() {
    await this.collectionManager.db.close();
  }

  protected static async testSqlConnection(dialect: SqlDialect, options: SqlConnectorOptions) {
    const db = new Database(createSqlDatabaseOptions(dialect, options));
    try {
      await db.sequelize.authenticate();
      return true;
    } catch (error) {
      throw new Error(`Unable to connect to ${dialect}: ${getErrorMessage(error)}`);
    } finally {
      await db.close();
    }
  }
}

export class MySQLDataSource extends SqlDataSource {
  constructor(options: SqlConnectorOptions) {
    super('mysql', options);
  }

  static testConnection(options: SqlConnectorOptions) {
    return this.testSqlConnection('mysql', options);
  }
}

export class PostgreSQLDataSource extends SqlDataSource {
  constructor(options: SqlConnectorOptions) {
    super('postgres', options);
  }

  static testConnection(options: SqlConnectorOptions) {
    return this.testSqlConnection('postgres', options);
  }
}
