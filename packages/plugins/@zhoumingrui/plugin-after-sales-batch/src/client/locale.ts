import { tExpr as createTExpr } from '@nocobase/flow-engine';
import { useApp } from '@nocobase/client';
import { useCallback } from 'react';

export const NAMESPACE = '@zhoumingrui/plugin-after-sales-batch';

export function useT() {
  const app = useApp();
  return useCallback(
    (key: string, options?: Record<string, unknown>) =>
      app.i18n.t(key, { ...options, ns: [NAMESPACE, 'client'], nsMode: 'fallback' }),
    [app],
  );
}

export function tExpr(key: string) {
  return createTExpr(key, { ns: [NAMESPACE, 'client'] });
}
