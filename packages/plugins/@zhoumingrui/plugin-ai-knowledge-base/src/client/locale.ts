/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import { useApp } from '@nocobase/client';
import { tExpr as _tExpr } from '@nocobase/flow-engine';
import { useCallback } from 'react';

export const namespace = '@zhoumingrui/plugin-ai-knowledge-base';

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
