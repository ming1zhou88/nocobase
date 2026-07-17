/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { useApp } from '@nocobase/client';
import { tExpr as _tExpr } from '@nocobase/flow-engine';
import { useCallback } from 'react';
// @ts-ignore
import pkg from '../../package.json';

export const namespace = pkg.name;

export function useT() {
  const app = useApp();
  return useCallback(
    (key: string, options?: Record<string, unknown>) =>
      app.i18n.t(key, { ...options, ns: [namespace, 'client'], nsMode: 'fallback' }),
    [app],
  );
}

export function tExpr(key: string) {
  return _tExpr(key, { ns: [namespace, 'client'] });
}
