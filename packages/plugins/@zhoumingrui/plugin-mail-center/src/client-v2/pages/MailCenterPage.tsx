/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { useCallback } from 'react';
import { useFlowContext } from '@nocobase/flow-engine';
import { MailCenter } from '../../client-common/MailCenter';
import type { MailRequest } from '../../client-common/types';
import { useT } from '../locale';

export default function MailCenterPage() {
  const ctx = useFlowContext();
  const t = useT();
  const request = useCallback<MailRequest>(
    async (action, values, filterByTk) => {
      const response = await ctx.api.request({
        url: `mailCenter:${action}${filterByTk == null ? '' : `/${filterByTk}`}`,
        method: 'post',
        data: values,
      });
      return response.data;
    },
    [ctx.api],
  );
  return <MailCenter request={request} t={t} />;
}
