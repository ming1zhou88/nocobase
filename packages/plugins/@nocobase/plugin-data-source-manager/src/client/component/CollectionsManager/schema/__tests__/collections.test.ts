/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { getCollectionSchema } from '../collections';

describe('getCollectionSchema', () => {
  it('binds external collection actions to the associated resource', () => {
    const schema = getCollectionSchema('mysql');
    const provider = Object.values(schema.properties)[0];

    expect(provider['x-decorator-props'].request).toMatchObject({
      resource: 'dataSources/mysql/collections',
      action: 'list',
      url: 'dataSources/mysql/collections:list',
    });
  });
});
