import { Application, Plugin } from '@nocobase/client-v2';
import { Typography } from 'antd';
import React from 'react';
import { NAMESPACE, useT } from './locale';
import { DailyCreateWorkOrderActionModel } from './models/DailyCreateWorkOrderActionModel';
import { DailyBatchAssignActionModel } from './models/DailyBatchAssignActionModel';
import { DailyAssignActionModel } from './models/DailyAssignActionModel';

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
    this.flowEngine.registerModels({
      DailyCreateWorkOrderActionModel,
      DailyBatchAssignActionModel,
      DailyAssignActionModel,
    });

    // B 页：Dify 生成，复用 A 页组件（组件内部根据路由参数区分行为）
    this.router.add('admin.after-sales-batch-dify', {
      path: '/admin/after-sales/batch-workbench-b',
      componentLoader: () => import('./pages/AfterSalesBatchPage'),
    });

    this.router.add('express-mail-notify', {
      path: '/admin/express-mail/notify',
      componentLoader: () => import('./pages/EmailNotifyPage'),
    });

    this.router.add('mabang-order-full', {
      path: '/admin/mabang-order/full',
      componentLoader: () => import('./pages/MabangOrderFullPage'),
    });

    // 快递异常工作台（预览）：只读 D4 Full，前端计算数据质量/异常状态；不改 7D4 查询逻辑。
    this.router.add('tracking-exception-workbench', {
      path: '/admin/tracking-exception/workbench',
      componentLoader: () => import('./pages/TrackingExceptionPage'),
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
