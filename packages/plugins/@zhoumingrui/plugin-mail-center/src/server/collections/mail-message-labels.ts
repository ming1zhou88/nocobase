/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'mailMessageLabels',
  title: 'Mail message labels',
  fields: [
    { type: 'bigInt', name: 'mailMessageId', allowNull: false, index: true },
    { type: 'bigInt', name: 'mailLabelId', allowNull: false, index: true },
  ],
});
