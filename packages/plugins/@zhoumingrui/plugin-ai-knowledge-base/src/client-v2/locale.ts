/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import { tExpr as baseTExpr, useFlowEngine } from '@nocobase/flow-engine';
// @ts-ignore
import pkg from './../../package.json';

export function useT() {
  const engine = useFlowEngine();
  return (key: string, options?: Record<string, unknown>) =>
    engine.context.t(key, { ...options, ns: [pkg.name, 'client'] });
}

export function tExpr(key: string) {
  return baseTExpr(key, { ns: [pkg.name, 'client'] });
}
