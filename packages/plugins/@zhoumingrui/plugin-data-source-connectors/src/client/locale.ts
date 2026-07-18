/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const NAMESPACE = '@zhoumingrui/plugin-data-source-connectors';

export function tExpr(key: string) {
  return `{{t(${JSON.stringify(key)}, { ns: ${JSON.stringify(NAMESPACE)} })}}`;
}
