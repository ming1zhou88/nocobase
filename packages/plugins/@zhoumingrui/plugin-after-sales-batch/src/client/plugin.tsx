import React from 'react';
import { Plugin } from '@nocobase/client';
import { Typography } from 'antd';
import { NAMESPACE, useT } from './locale';
import { AfterSalesBatchPage } from './pages/AfterSalesBatchPage';
import { DailyCreateWorkOrderActionModel } from '../client-v2/models/DailyCreateWorkOrderActionModel';
import { DailyBatchAssignActionModel } from '../client-v2/models/DailyBatchAssignActionModel';
import { DailyAssignActionModel } from '../client-v2/models/DailyAssignActionModel';

/**
 * 售后处理指南：两个页面并行存在。
 *
 * - A 页（本地生成，原版）：/admin/after-sales/batch-workbench
 *   由 NocoBase 内置 AI 员工生成指南，Dify 不可用时兜底。
 * - B 页（Dify 生成）：/admin/after-sales/batch-workbench-b
 *   由连接器调 Dify 生成指南，日常使用。
 *
 * 两页各自调用独立的服务端资源（afterSalesBatchLocal / afterSalesBatch），
 * 数据也分别落在 NocoBase 自己的表与连接器的表，互不影响。
 */
export const AFTER_SALES_BATCH_ROUTE_PATH = '/admin/after-sales/batch-workbench';
export const AFTER_SALES_BATCH_DIFY_ROUTE_PATH = '/admin/after-sales/batch-workbench-b';
export const AFTER_SALES_NOTIFY_ROUTE_PATH = '/admin/express-mail/notify';

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
    // 每日售后订单页是 FlowEngine 页面；确保自定义 action 模型在当前客户端也注册。
    const flowEngine = (this.app as any).flowEngine;
    if (flowEngine?.registerModels) {
      flowEngine.registerModels({
        DailyCreateWorkOrderActionModel,
        DailyBatchAssignActionModel,
        DailyAssignActionModel,
      });
    }

    // A 页：本地生成（原版），保留原有链接不变。
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
