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

/**
 * 前端 chunk 兜底（阶段 1）。
 *
 * 背景：生产 NocoBase 偶发几秒无响应，或部署窗口内服务短暂不可用，
 * 页面懒加载的 JS chunk 请求失败后，NocoBase 错误边界会直接渲染
 * “Something went wrong”，用户只能手动刷新。
 *
 * 这里在脚本加载失败 / chunk Promise 拒绝时自动整页重载一次：
 * - 60 秒节流（sessionStorage），避免服务长时间不可用时反复刷新；
 * - 重载前显示一行轻提示，避免用户以为页面坏了。
 */
const CHUNK_RELOAD_KEY = 'asb-chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 60 * 1000;

function showChunkReloadHint() {
  if (typeof document === 'undefined' || document.getElementById('asb-chunk-reload-hint')) {
    return;
  }
  const tip = document.createElement('div');
  tip.id = 'asb-chunk-reload-hint';
  tip.textContent = '服务正在更新，正在自动重试…';
  tip.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
    'background:#fff7e6;border:1px solid #ffd591;color:#ad4e00;padding:8px 16px;' +
    'border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.12)';
  document.body.appendChild(tip);
}

function reloadAfterChunkError() {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) {
      return;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage 不可用时放弃自动重试，避免刷新循环
    return;
  }
  showChunkReloadHint();
  window.setTimeout(() => window.location.reload(), 800);
}

function installChunkLoadGuard() {
  if (typeof window === 'undefined' || (window as any).__asbChunkGuardInstalled) {
    return;
  }
  (window as any).__asbChunkGuardInstalled = true;
  // 资源加载失败不冒泡，必须在捕获阶段监听
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLScriptElement | null;
      if (!target || target.tagName !== 'SCRIPT') {
        return;
      }
      const src = target.src || '';
      if (!/\/static\/plugins\/|\/v\/assets\//.test(src)) {
        return;
      }
      reloadAfterChunkError();
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    const reason: any = (event as PromiseRejectionEvent).reason;
    const message = typeof reason === 'string' ? reason : reason?.message || '';
    if (/Loading chunk .* failed|ChunkLoadError|Importing a module script failed/i.test(message)) {
      reloadAfterChunkError();
    }
  });
}

installChunkLoadGuard();

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
    // 确认订单工作台：标准邮件合成 → 确认订单工作台
    this.router.add('admin.order-confirm-workbench', {
      path: '/admin/order-confirm/workbench',
      componentLoader: () => import('./pages/ConfirmOrdersPage'),
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
