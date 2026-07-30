/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  create: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
  },
}));

import { NocoBaseRemoteClient } from '../nocobase-client';

describe('NocoBaseRemoteClient', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.create.mockReset();
    mocks.create.mockReturnValue({
      get: mocks.get,
      post: mocks.post,
    });
  });

  it('normalizes remote collection and field metadata', async () => {
    mocks.get.mockResolvedValue({
      data: {
        data: [
          {
            name: 'orders',
            title: 'Orders',
            fields: [
              {
                name: 'id',
                options: {
                  type: 'bigInt',
                  primaryKey: true,
                },
              },
            ],
          },
        ],
      },
    });

    const client = new NocoBaseRemoteClient({
      baseUrl: 'https://example.com/',
      apiToken: 'token',
    });
    const collections = await client.getCollections();

    expect(collections).toEqual([
      expect.objectContaining({
        name: 'orders',
        tableName: 'orders',
        fields: [expect.objectContaining({ name: 'id', field: 'id', type: 'bigInt' })],
      }),
    ]);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://example.com/api',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });

  it('uses the remote data source collection endpoint and header', async () => {
    mocks.get.mockResolvedValue({ data: { data: [] } });
    const client = new NocoBaseRemoteClient({
      baseUrl: 'https://example.com',
      apiToken: 'token',
      dataSourceKey: 'warehouse',
    });

    await client.getCollections();

    expect(mocks.get).toHaveBeenCalledWith('/dataSources/warehouse/collections:list', expect.any(Object));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Data-Source': 'warehouse' }),
      }),
    );
  });

  it('creates and destroys collections in the remote main data source', async () => {
    mocks.post.mockResolvedValue({ data: { data: { name: 'orders' } } });
    const client = new NocoBaseRemoteClient({
      baseUrl: 'https://example.com',
      apiToken: 'token',
    });

    await expect(client.createCollection({ name: 'orders', template: 'general' })).resolves.toEqual({
      name: 'orders',
    });
    await client.destroyCollections(['orders'], true);

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/collections:create', {
      values: { name: 'orders', template: 'general' },
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/collections:destroy', {
      filterByTk: ['orders'],
      cascade: true,
    });
  });

  it('uses the remote external data source collection mutation endpoints', async () => {
    mocks.post.mockResolvedValue({ data: { data: {} } });
    const client = new NocoBaseRemoteClient({
      baseUrl: 'https://example.com',
      apiToken: 'token',
      dataSourceKey: 'warehouse',
    });

    await client.createCollection({ name: 'orders' });
    await client.destroyCollections('orders');

    expect(mocks.post).toHaveBeenNthCalledWith(1, '/dataSources/warehouse/collections:create', {
      values: { name: 'orders' },
    });
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/dataSources/warehouse/collections:destroy', {
      filterByTk: 'orders',
      cascade: false,
    });
  });
});
