/**
 * 每日售后订单：从工作台发起售后工单（NocoBase 动作，薄转发）
 *
 * 依据：doc/aftersale/开发需求说明书-售后订单指派与工单流转-v1.md §4.6
 *
 * 这里只做转发——建单、幂等、回写 `work_order_serial` 全在连接器里完成，
 * 与项目既有的 "插件只做转发壳、业务逻辑在连接器" 保持一致
 * （连接器有 674 个用例的测试基建，插件侧不重复实现业务逻辑）。
 */
import type { Context, Next } from '@nocobase/actions';
import { connectorClient } from './services/connector-client';

export async function createDailyAfterSalesWorkOrder(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dailyOrderId = Number(values.daily_order_id ?? values.dailyOrderId ?? ctx.action.params?.filterByTk);
  if (!Number.isInteger(dailyOrderId) || dailyOrderId <= 0) {
    ctx.throw(400, 'daily_order_id is required');
  }

  ctx.body = await connectorClient.createDailyAfterSalesWorkOrder({
    daily_order_id: dailyOrderId,
    overrides: (values.overrides as Record<string, unknown>) || undefined,
    force: Boolean(values.force),
  });

  await next();
}

export const DAILY_AFTER_SALES_RESOURCE = 'dailyAfterSales';

export const DAILY_AFTER_SALES_ACTIONS = {
  createWorkOrder: createDailyAfterSalesWorkOrder,
};
