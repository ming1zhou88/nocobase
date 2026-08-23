import { Application, Plugin } from '@nocobase/client-v2';
import { Typography } from 'antd';
import React from 'react';
import { NAMESPACE, useT } from './locale';

type AsyncTaskManagerClientV2Plugin = {
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

export class PluginAfterSalesBatchClientV2 extends Plugin<unknown, Application> {
  async load() {
    this.router.add('after-sales-batch', {
      path: '/after-sales/batch-workbench',
      componentLoader: () => import('./pages/AfterSalesBatchPage'),
    });

    (this.app.pm.get('async-task-manager') as AsyncTaskManagerClientV2Plugin | undefined)?.taskOrigins.register(
      'afterSalesBatch',
      {
        Result: AfterSalesBatchTaskResult,
        namespace: NAMESPACE,
      },
    );
  }
}

export default PluginAfterSalesBatchClientV2;
