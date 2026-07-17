/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { normalizeConnectorValues } from '../normalize-values';

describe('normalizeConnectorValues', () => {
  it('keeps the manager collection selection in connector options', () => {
    expect(
      normalizeConnectorValues({
        type: 'mysql',
        collections: ['orders', 'customers'],
        options: { host: 'localhost' },
      }),
    ).toEqual({
      type: 'mysql',
      collections: ['orders', 'customers'],
      options: {
        host: 'localhost',
        collections: ['orders', 'customers'],
      },
    });
  });
});
