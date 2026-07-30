/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Context } from '@nocobase/actions';
import {
  CollectionManager,
  DatabaseDataSource,
  type CollectionOptions,
  type DatabaseIntrospector,
} from '@nocobase/data-source-manager';
import { NocoBaseRemoteClient } from './nocobase-client';
import { NocoBaseRepository } from './nocobase-repository';
import type {
  DataSourceMutationContext,
  NocoBaseConnectorOptions,
  RemoteCollectionMetadata,
  RemoteFieldMetadata,
} from './types';
import { getErrorMessage, normalizeCollectionSelection, saveSelectedCollections } from './utils';

function normalizeField(field: RemoteFieldMetadata) {
  return {
    ...field,
    field: field.field || field.name,
    type: field.type || 'string',
    rawType: field.rawType || field.type || 'string',
  };
}

function normalizeCollection(collection: RemoteCollectionMetadata): CollectionOptions {
  return {
    ...collection,
    name: collection.name,
    title: collection.title || collection.name,
    tableName: collection.tableName || collection.name,
    filterTargetKey: collection.filterTargetKey || 'id',
    fields: (collection.fields || []).map(normalizeField),
    timestamps: false,
    autoGenId: false,
    introspected: true,
    uiManageable: false,
    repository: 'NocoBaseRepository',
  } as CollectionOptions;
}

export class NocoBaseDataSource extends DatabaseDataSource<DatabaseIntrospector> {
  declare collectionManager: CollectionManager;
  declare options: NocoBaseConnectorOptions & { name: string };
  readonly remoteClient: NocoBaseRemoteClient;

  constructor(options: NocoBaseConnectorOptions) {
    super(options);
    this.remoteClient = new NocoBaseRemoteClient(options);
    this.introspector = {
      getTables: async () => (await this.remoteClient.getCollections()).map((collection) => collection.name),
    } as DatabaseIntrospector;
  }

  createCollectionManager() {
    const manager = new CollectionManager();
    manager.registerRepositories({
      NocoBaseRepository,
    });
    return manager;
  }

  async readTables() {
    const collections = await this.remoteClient.getCollections();
    return collections.map((collection) => ({ name: collection.name }));
  }

  async loadTables(ctx: Context, tables: string[]) {
    const collections = await this.remoteClient.getCollections();
    const names = new Set(collections.map((collection) => collection.name));
    const invalidCollections = tables.filter((table) => !names.has(table));
    if (invalidCollections.length) {
      throw new Error(`Unknown remote collections: ${invalidCollections.join(', ')}`);
    }
    saveSelectedCollections(ctx as DataSourceMutationContext, tables);
  }

  async load(loadOptions: { localData?: Record<string, CollectionOptions> } = {}) {
    const remoteCollections = await this.remoteClient.getCollections();
    const selectedNames = new Set(
      (this.options.collections || []).map((selection) => normalizeCollectionSelection(selection).name),
    );
    const selectedCollections = this.options.addAllCollections
      ? remoteCollections
      : remoteCollections.filter((collection) => selectedNames.has(collection.name));
    const normalizedCollections = selectedCollections.map(normalizeCollection);
    const mergedCollections = this.mergeWithLoadedCollections(normalizedCollections, loadOptions.localData || {});
    mergedCollections.forEach((collection, index) => {
      this.collectionManager.defineCollection(collection);
      this.emitLoadingProgress({ total: mergedCollections.length, loaded: index + 1 });
    });
  }

  async createCollection(values: Record<string, unknown>) {
    if (this.options.readOnly !== false) {
      throw new Error('NocoBase data source is read-only');
    }
    const result = await this.remoteClient.createCollection(values);
    await this.load();
    return result;
  }

  async destroyCollection(filterByTk: string | string[], options: { cascade?: boolean } = {}) {
    if (this.options.readOnly !== false) {
      throw new Error('NocoBase data source is read-only');
    }
    const names = Array.isArray(filterByTk) ? filterByTk : [filterByTk];
    const result = await this.remoteClient.destroyCollections(filterByTk, options.cascade);
    names.forEach((name) => this.collectionManager.removeCollection(name));
    return result;
  }

  async close() {}

  static async testConnection(options: NocoBaseConnectorOptions) {
    try {
      return await new NocoBaseRemoteClient(options).testConnection();
    } catch (error) {
      throw new Error(`Unable to connect to NocoBase: ${getErrorMessage(error)}`);
    }
  }
}
