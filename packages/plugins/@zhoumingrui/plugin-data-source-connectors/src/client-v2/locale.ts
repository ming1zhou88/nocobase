/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { tExpr as createTExpr, useFlowEngine } from '@nocobase/flow-engine';
import pkg from '../../package.json';

export const NAMESPACE = pkg.name;

export function tExpr(key: string) {
  return createTExpr(key, { ns: [NAMESPACE, 'client'] });
}

export function useT() {
  const engine = useFlowEngine();
  return (key: string, options?: Record<string, unknown>) =>
    engine.context.t(key, { ns: [NAMESPACE, 'client'], ...options });
}
