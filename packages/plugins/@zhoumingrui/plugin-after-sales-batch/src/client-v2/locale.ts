import { tExpr as createTExpr, useFlowEngine } from '@nocobase/flow-engine';

export const NAMESPACE = '@zhoumingrui/plugin-after-sales-batch';

export function tExpr(key: string) {
  return createTExpr(key, { ns: [NAMESPACE, 'client'], nsMode: 'fallback' });
}

export function useT() {
  const engine = useFlowEngine();
  return (key: string, options?: Record<string, unknown>) =>
    engine.context.t(key, { ns: [NAMESPACE, 'client'], nsMode: 'fallback', ...options });
}
