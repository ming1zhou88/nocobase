/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function normalizeConnectorValues(values: Record<string, unknown>) {
  const options = values.options && typeof values.options === 'object' ? values.options : {};
  const collections = Array.isArray(values.collections) ? values.collections : [];
  return {
    ...values,
    collections,
    options: {
      ...options,
      collections,
    },
  };
}
