/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import pkg from '../../package.json';

export const NAMESPACE = pkg.name;

export function tExpr(key: string) {
  return `{{t(${JSON.stringify(key)}, { ns: ${JSON.stringify(NAMESPACE)} })}}`;
}
