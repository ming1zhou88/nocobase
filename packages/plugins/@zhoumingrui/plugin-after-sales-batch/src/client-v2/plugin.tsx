import { Application, Plugin } from '@nocobase/client-v2';
import { Typography } from 'antd';
import React from 'react';
import { NAMESPACE, useT } from './locale';
import { DailyCreateWorkOrderActionModel } from './models/DailyCreateWorkOrderActionModel';
import { DailyBatchAssignActionModel } from './models/DailyBatchAssignActionModel';
import { DailyAssignActionModel } from './models/DailyAssignActionModel';
import { DailyBatchCopyOrderIdsActionModel } from './models/DailyBatchCopyOrderIdsActionModel';
import { DailyBatchMarkProcessedActionModel } from './models/DailyBatchMarkProcessedActionModel';
import { DailyMarkProcessedActionModel } from './models/DailyMarkProcessedActionModel';
import { DailyTypeLabelFilterActionModel } from './models/DailyTypeLabelFilterActionModel';
import { SecondReplyGenerateActionModel } from './models/SecondReplyGenerateActionModel';
import { SecondReplySendActionModel } from './models/SecondReplySendActionModel';
import { RecordDetailActionModel } from './models/RecordDetailActionModel';
import { FeedbackMarkActionModel } from './models/FeedbackMarkActionModel';
import { OverseasAfterSalesActionModel } from './models/OverseasAfterSalesActionModel';
import { DailyScopeFilterActionModel } from './models/DailyScopeFilterActionModel';
import { DailySetHandleStatusActionModel } from './models/DailySetHandleStatusActionModel';
import { DailyBatchSetHandleStatusActionModel } from './models/DailyBatchSetHandleStatusActionModel';
import { DailyRefreshActionModel } from './models/DailyRefreshActionModel';
import { DailyReturnRequestActionModel } from './models/DailyReturnRequestActionModel';

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
      DailyBatchCopyOrderIdsActionModel,
      DailyBatchMarkProcessedActionModel,
      DailyMarkProcessedActionModel,
      DailyTypeLabelFilterActionModel,
      SecondReplyGenerateActionModel,
      SecondReplySendActionModel,
      FeedbackMarkActionModel,
      RecordDetailActionModel,
      OverseasAfterSalesActionModel,
      DailyScopeFilterActionModel,
      DailySetHandleStatusActionModel,
      DailyBatchSetHandleStatusActionModel,
      DailyRefreshActionModel,
      DailyReturnRequestActionModel,
    });

    // B 页：Dify 生成，复用 A 页组件（组件内部根据路由参数区分行为）
    this.router.add('admin.after-sales-batch-dify', {
      path: '/admin/after-sales/batch-workbench-b',
      componentLoader: () => import('./pages/AfterSalesBatchPage'),
    });

    // 领星退货申请工作台（列表/指派/状态/沟通等待时长）
    this.router.add('admin.return-request-workbench', {
      path: '/admin/return-request/workbench',
      componentLoader: () => import('./pages/ReturnRequestPage'),
    });

    this.router.add('admin.express-mail-notify', {
      path: '/admin/express-mail/notify',
      componentLoader: () => import('./pages/EmailNotifyPage'),
    });

    this.router.add('admin.mabang-order-full', {
      path: '/admin/mabang-order/full',
      componentLoader: () => import('./pages/MabangOrderFullPage'),
    });

    // 快递异常工作台（预览）：只读 7D4，前端计算数据质量/异常状态；不改 7D4 查询逻辑。
    this.router.add('admin.tracking-exception-workbench', {
      path: '/admin/tracking-exception/workbench',
      componentLoader: () => import('./pages/TrackingExceptionPage'),
    });

    this.router.add('admin.tracking-exception-help', {
      path: '/admin/tracking-exception/help',
      componentLoader: () => import('./pages/TrackingExceptionHelpPage'),
    });

    this.router.add('admin.tracking-exception-handling-detail', {
      path: '/admin/tracking-exception/handling-detail',
      componentLoader: () => import('./pages/HandlingDetailPage'),
    });

    this.router.add('admin.tracking-exception-handling-summary', {
      path: '/admin/tracking-exception/handling-summary',
      componentLoader: () => import('./pages/HandlingSummaryPage'),
    });

    this.router.add('admin.tracking-exception-recovery-detail', {
      path: '/admin/tracking-exception/recovery-detail',
      componentLoader: () => import('./pages/RecoveryDetailPage'),
    });
    this.router.add('admin.after-sales-warehouse-contacts', {
      path: '/admin/after-sales/warehouse-contacts',
      componentLoader: () => import('./pages/AfterSalesRequestsPage'),
    });

    this.router.add('admin.after-sales-reship-requests', {
      path: '/admin/after-sales/reship-requests',
      componentLoader: () => import('./pages/AfterSalesRequestsPage'),
    });

    this.router.add('admin.after-sales-refund-requests', {
      path: '/admin/after-sales/refund-requests',
      componentLoader: () => import('./pages/AfterSalesRequestsPage'),
    });

    this.router.add('admin.after-sales-claim-requests', {
      path: '/admin/after-sales/claim-requests',
      componentLoader: () => import('./pages/AfterSalesRequestsPage'),
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
