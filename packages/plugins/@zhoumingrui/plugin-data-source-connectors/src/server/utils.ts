/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CollectionSelection, ConnectorOptions, DataSourceMutationContext } from './types';

export const MUTATING_ACTIONS = new Set([
  'add',
  'create',
  'destroy',
  'firstOrCreate',
  'move',
  'remove',
  'set',
  'toggle',
  'update',
  'updateOrCreate',
]);

export function normalizePositiveInteger(value: number | string | undefined, fallback: number, max: number) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed) || !parsed || parsed < 1) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

export function normalizeCollectionSelection(selection: CollectionSelection) {
  if (typeof selection === 'string') {
    return { name: selection };
  }
  return selection;
}

export function saveSelectedCollections(ctx: DataSourceMutationContext, tables: string[]) {
  const values = ctx.action.params.values;
  if (!values) {
    throw new Error('Data source values are required');
  }
  values.options = {
    ...(values.options || {}),
    collections: tables,
  };
}

export function isTransientDataSource(dataSource: {
  name: string;
  dataSourceManager?: { get(name: string): unknown };
}) {
  return dataSource.dataSourceManager?.get(dataSource.name) !== dataSource;
}

export function isReadOnly(options: ConnectorOptions) {
  return options.readOnly !== false;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
