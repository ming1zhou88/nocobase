/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import React, { useCallback } from 'react';
import { useAPIClient } from '@nocobase/client';
import { MailCenter } from '../../client-common/MailCenter';
import type { MailRequest } from '../../client-common/types';
import { useT } from '../locale';

export function MailCenterPage() {
  const api = useAPIClient();
  const t = useT();
  const request = useCallback<MailRequest>(
    async (action, values, filterByTk) => {
      const response = await api.request({
        url: `mailCenter:${action}${filterByTk == null ? '' : `/${filterByTk}`}`,
        method: 'post',
        data: values,
      });
      return response.data;
    },
    [api],
  );
  return <MailCenter request={request} t={t} />;
}

export default MailCenterPage;
