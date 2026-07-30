/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import resource from '../resourcers/data-sources-collections';

describe('dataSources.collections resource', () => {
  it('persists created collection metadata for reloads', async () => {
    const values = {
      name: 't_orders',
      title: 'Orders',
      filterTargetKey: ['id'],
      fields: [
        { name: 'id', type: 'bigInt', primaryKey: true },
        { name: 'createdBy', type: 'belongsTo', target: 'users', foreignKey: 'createdById' },
      ],
    };
    const createCollection = vi.fn().mockResolvedValue({ ...values, introspected: true });
    const create = vi.fn().mockResolvedValue({ toJSON: () => ({ ...values, dataSourceKey: 'mysql' }) });
    const setField = vi.fn();
    const getCollection = vi.fn(() => ({ setField }));
    const next = vi.fn();
    const ctx = {
      action: { params: { associatedIndex: 'mysql', values } },
      app: {
        dataSourceManager: {
          dataSources: new Map([['mysql', { createCollection, collectionManager: { getCollection } }]]),
        },
      },
      db: { getRepository: vi.fn(() => ({ create })) },
      body: undefined,
      throw: vi.fn(),
    };

    await resource.actions.create(ctx, next);

    expect(createCollection).toHaveBeenCalledWith(values);
    expect(create).toHaveBeenCalledWith({
      values: expect.objectContaining({
        name: 't_orders',
        title: 'Orders',
        filterTargetKey: ['id'],
        dataSourceKey: 'mysql',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'createdBy', type: 'belongsTo', targetKey: 'id' }),
        ]),
      }),
      updateAssociationValues: ['fields'],
    });
    expect(ctx.body).toEqual({ ...values, dataSourceKey: 'mysql' });
    expect(getCollection).toHaveBeenCalledWith('t_orders');
    expect(setField).toHaveBeenCalledWith(
      'id',
      expect.objectContaining({ name: 'id', type: 'bigInt', primaryKey: true }),
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
