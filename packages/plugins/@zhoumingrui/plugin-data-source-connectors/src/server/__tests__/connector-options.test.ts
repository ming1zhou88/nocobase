/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { createSqlDatabaseOptions } from '../sql-data-source';
import { normalizePositiveInteger, saveSelectedCollections } from '../utils';

describe('connector option normalization', () => {
  it('creates bounded MySQL connection and pool options', () => {
    const options = createSqlDatabaseOptions('mysql', {
      host: '127.0.0.1',
      port: '3307',
      database: 'business',
      username: 'reader',
      password: 'secret',
      connectionTimeoutMs: 5000,
      poolMax: 200,
    });

    expect(options).toMatchObject({
      dialect: 'mysql',
      port: 3307,
      database: 'business',
      pool: {
        max: 50,
        acquire: 5000,
      },
    });
  });

  it('maps PostgreSQL SSL verification settings', () => {
    const options = createSqlDatabaseOptions('postgres', {
      host: 'db.example.com',
      database: 'business',
      username: 'reader',
      schema: 'reporting',
      ssl: { sslMode: 'verify-full', ca: 'certificate' },
    });

    expect(options).toMatchObject({
      dialect: 'postgres',
      schema: 'reporting',
      dialectOptions: {
        ssl: {
          rejectUnauthorized: true,
          ca: 'certificate',
        },
      },
    });
  });

  it('stores validated table selections inside connector options', () => {
    const context = {
      action: {
        params: {
          values: {
            options: {
              host: 'localhost',
            },
          },
        },
      },
    };

    saveSelectedCollections(context as never, ['orders', 'customers']);

    expect(context.action.params.values.options).toEqual({
      host: 'localhost',
      collections: ['orders', 'customers'],
    });
  });

  it('falls back and caps positive integer settings', () => {
    expect(normalizePositiveInteger('invalid', 10, 50)).toBe(10);
    expect(normalizePositiveInteger(100, 10, 50)).toBe(50);
  });
});
