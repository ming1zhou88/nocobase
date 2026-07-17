/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NocoBaseRepository } from '../nocobase-repository';

describe('NocoBaseRepository', () => {
  it('does not forward the local request context to the remote API', async () => {
    const list = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], count: 1 });
    const repository = new NocoBaseRepository({
      name: 'orders',
      collectionManager: {
        dataSource: {
          options: { readOnly: true },
          remoteClient: { list },
        },
      },
    } as never);

    const records = await repository.find({ context: { local: true }, filter: { status: 'open' } });

    expect(records[0].toJSON()).toEqual({ id: 1 });
    expect(list).toHaveBeenCalledWith('orders', {
      filter: { status: 'open' },
      paginate: false,
    });
  });

  it('blocks writes while the connector is read-only', async () => {
    const repository = new NocoBaseRepository({
      name: 'orders',
      collectionManager: {
        dataSource: {
          options: { readOnly: true },
          remoteClient: {},
        },
      },
    } as never);

    await expect(repository.create({ values: { title: 'Blocked' } })).rejects.toThrow('read-only');
  });
});
