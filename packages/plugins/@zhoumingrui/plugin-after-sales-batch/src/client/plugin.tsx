import React from 'react';
import { Plugin } from '@nocobase/client';
import { Typography } from 'antd';
import { NAMESPACE, useT } from './locale';
import { AfterSalesBatchPage } from './pages/AfterSalesBatchPage';

export const AFTER_SALES_BATCH_ROUTE_PATH = '/admin/after-sales/batch-workbench';

type AsyncTaskManagerClientPlugin = {
  taskOrigins: {
    register: (name: string, value: { Result?: React.ComponentType<any>; namespace?: string }) => void;
  };
};

const AfterSalesBatchTaskResult = ({ payload }: { payload?: Record<string, any> }) => {
  const t = useT();
  const parts: string[] = [];
  if (payload?.total != null) parts.push(`${t('Total')} ${payload.total}`);
  if (payload?.completed != null) parts.push(`${t('Completed')} ${payload.completed}`);
  if (payload?.failed != null) parts.push(`${t('Failed')} ${payload.failed}`);
  if (payload?.skipped != null) parts.push(`${t('Skipped')} ${payload.skipped}`);
  return <Typography.Text>{parts.join('，')}</Typography.Text>;
};

export class PluginAfterSalesBatchClient extends Plugin {
  async load() {
    this.app.router.add('admin.after-sales-batch', {
      path: AFTER_SALES_BATCH_ROUTE_PATH,
      Component: AfterSalesBatchPage,
    });

    (this.app.pm.get('async-task-manager') as AsyncTaskManagerClientPlugin | undefined)?.taskOrigins.register(
      'afterSalesBatch',
      {
        Result: AfterSalesBatchTaskResult,
        namespace: NAMESPACE,
      },
    );
  }
}

export default PluginAfterSalesBatchClient;
