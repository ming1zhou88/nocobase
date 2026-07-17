/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ICollection } from '@nocobase/data-source-manager';
import type { NocoBaseDataSource } from './nocobase-data-source';

class RemoteRecord {
  constructor(private readonly values: Record<string, unknown>) {}

  get(key?: string) {
    return key ? this.values[key] : this.values;
  }

  toJSON() {
    return this.values;
  }
}

type RemoteCollection = ICollection & {
  name: string;
  collectionManager: {
    dataSource: NocoBaseDataSource;
  };
};

function toRecord(value: Record<string, unknown>) {
  return new RemoteRecord(value);
}

function toRemoteParams(options: Record<string, unknown>) {
  const { context, ...params } = options;
  return params;
}

export class NocoBaseRepository {
  declare collection: RemoteCollection;

  constructor(collection: RemoteCollection) {
    this.collection = collection;
  }

  private get dataSource() {
    return this.collection.collectionManager.dataSource;
  }

  private get client() {
    return this.dataSource.remoteClient;
  }

  private assertWritable() {
    if (this.dataSource.options.readOnly !== false) {
      throw new Error('This external data source is configured as read-only');
    }
  }

  async find(options: Record<string, unknown> = {}) {
    const result = await this.client.list(this.collection.name, { ...toRemoteParams(options), paginate: false });
    return result.rows.map(toRecord);
  }

  async findAndCount(options: Record<string, unknown> = {}) {
    const limit = typeof options.limit === 'number' ? options.limit : 50;
    const offset = typeof options.offset === 'number' ? options.offset : 0;
    const params = toRemoteParams(options);
    delete params.limit;
    delete params.offset;
    const result = await this.client.list(this.collection.name, {
      ...params,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
    });
    return [result.rows.map(toRecord), result.count] as [RemoteRecord[], number];
  }

  async findOne(options: Record<string, unknown> = {}) {
    return toRecord(await this.client.get(this.collection.name, toRemoteParams(options)));
  }

  async count(options: Record<string, unknown> = {}) {
    const result = await this.client.list(this.collection.name, {
      ...toRemoteParams(options),
      page: 1,
      pageSize: 1,
    });
    return result.count;
  }

  async create(options: Record<string, unknown>) {
    this.assertWritable();
    return toRecord(await this.client.create(this.collection.name, toRemoteParams(options)));
  }

  async update(options: Record<string, unknown>) {
    this.assertWritable();
    return this.client.update(this.collection.name, toRemoteParams(options));
  }

  async destroy(options: Record<string, unknown>) {
    this.assertWritable();
    return this.client.destroy(this.collection.name, toRemoteParams(options));
  }
}
