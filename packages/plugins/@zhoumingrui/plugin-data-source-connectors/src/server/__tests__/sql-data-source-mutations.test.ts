/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { MySQLDataSource } from '../sql-data-source';

function createDataSource(readOnly: boolean) {
  const sync = vi.fn();
  const drop = vi.fn();
  const removeCollection = vi.fn();
  const setField = vi.fn();
  const removeField = vi.fn();
  const fieldOptions = { name: 'name', type: 'string' };
  const collection = vi.fn(() => ({
    options: { name: 'orders' },
    sync,
  }));
  const getCollection = vi.fn(() => ({
    model: { drop },
    hasField: vi.fn(() => false),
    setField,
    removeField,
    getField: vi.fn(() => ({ options: fieldOptions })),
    sync,
  }));
  const dataSource = Object.create(MySQLDataSource.prototype) as MySQLDataSource;
  Object.defineProperties(dataSource, {
    options: { value: { name: 'mysql', readOnly }, writable: true },
    collectionManager: {
      value: {
        db: {
          collection,
          getCollection,
          hasCollection: vi.fn(() => false),
          removeCollection,
        },
      },
      writable: true,
    },
  });
  return { collection, dataSource, drop, removeCollection, removeField, setField, sync };
}

describe('SQL data source collection mutations', () => {
  it('creates and deletes physical collections in read/write mode', async () => {
    const { collection, dataSource, drop, removeCollection, sync } = createDataSource(false);

    await expect(dataSource.createCollection({ name: 'orders', fields: [] })).resolves.toEqual({ name: 'orders' });
    expect(collection).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders', introspected: true }));
    expect(sync).toHaveBeenCalledOnce();

    await dataSource.destroyCollection('orders', { cascade: true });
    expect(drop).toHaveBeenCalledWith({ cascade: true });
    expect(removeCollection).toHaveBeenCalledWith('orders');
  });

  it('rejects schema mutations in read-only mode', async () => {
    const { dataSource } = createDataSource(true);

    await expect(dataSource.createCollection({ name: 'orders' })).rejects.toThrow('read-only');
    await expect(dataSource.destroyCollection('orders')).rejects.toThrow('read-only');
    await expect(dataSource.createField('orders', { name: 'name', type: 'string' })).rejects.toThrow('read-only');
    await expect(dataSource.destroyField('orders', 'name')).rejects.toThrow('read-only');
  });

  it('creates a physical scalar field', async () => {
    const { dataSource, removeField, setField, sync } = createDataSource(false);

    await expect(dataSource.createField('orders', { name: 'name', type: 'string' })).resolves.toEqual({
      name: 'name',
      type: 'string',
    });

    expect(setField).toHaveBeenCalledWith('name', { name: 'name', type: 'string' });
    expect(sync).toHaveBeenCalledOnce();
    expect(removeField).not.toHaveBeenCalled();
  });

  it('drops a physical scalar field', async () => {
    const { dataSource, removeField, setField, sync } = createDataSource(false);

    await dataSource.destroyField('orders', 'name');

    expect(removeField).toHaveBeenCalledWith('name');
    expect(sync).toHaveBeenCalledOnce();
    expect(setField).not.toHaveBeenCalled();
  });

  it('rolls back field removal when sync fails', async () => {
    const { dataSource, removeField, setField, sync } = createDataSource(false);
    sync.mockRejectedValueOnce(new Error('sync failed'));

    await expect(dataSource.destroyField('orders', 'name')).rejects.toThrow('sync failed');
    expect(removeField).toHaveBeenCalledWith('name');
    expect(setField).toHaveBeenCalledWith('name', { name: 'name', type: 'string' });
  });
});
