/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of @zhoumingrui/plugin-ai-knowledge-base.
 * NocoBase and its upstream source code remain subject to their own
 * copyright notices and license terms. See NOTICE for details.
 */

import { tExpr as baseTExpr, useFlowEngine } from '@nocobase/flow-engine';

export const NAMESPACE = '@zhoumingrui/plugin-ai-knowledge-base';

export function useT() {
  const engine = useFlowEngine();
  return (key: string, options?: Record<string, unknown>) =>
    engine.context.t(key, { ...options, ns: [NAMESPACE, 'client'] });
}

export function tExpr(key: string) {
  return baseTExpr(key, { ns: [NAMESPACE, 'client'] });
}
