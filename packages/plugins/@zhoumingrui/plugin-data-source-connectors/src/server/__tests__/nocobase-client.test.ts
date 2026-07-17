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
});
