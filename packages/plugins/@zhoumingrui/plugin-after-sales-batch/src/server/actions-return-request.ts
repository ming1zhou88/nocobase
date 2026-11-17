/**
 * 领星退货申请工作台：NocoBase 薄接口 → Connector `/ai/return-orders/*`
 *
 * 设计：
 *  - 列表/统计/指派/状态全部转发到连接器，业务逻辑（责任人表、邮件沟通、状态联动）只在连接器一处；
 *  - 鉴权：NocoBase 登录态 + Connector 的 AFTER_SALES_BATCH_TOKEN（服务端持有，不下发浏览器）。
 */
import type { Context, Next } from '@nocobase/actions';
import { connectorClient } from './services/connector-client';
import { isAssigner } from './after-sales-roles';

export const RETURN_REQUEST_RESOURCE = 'returnRequestWorkbench';

function paramsWithQuery(ctx: Context) {
    const params = (ctx.action?.params || {}) as any;
    return { ...(params.values || {}), ...(ctx.query || {}) };
}

async function list(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderList(paramsWithQuery(ctx));
    await next();
}

async function stats(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderStats(paramsWithQuery(ctx));
    await next();
}

async function assign(ctx: Context, next: Next) {
    if (!(await isAssigner(ctx))) {
        ctx.throw(403, '只有售后主管/值班可以指派退货申请');
    }
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    const operator = (ctx.state?.currentUser?.nickname
        || ctx.state?.currentUser?.username
        || 'nocoBase') as string;
    ctx.body = await connectorClient.returnOrderAssign({ ...body, operator });
    await next();
}

async function status(ctx: Context, next: Next) {
    const params = (ctx.action?.params || {}) as any;
    const values = (params.values || ctx.request.body || {}) as any;
    const ids = (Array.isArray(values.ids) ? values.ids : [values.id]).map(Number).filter(Boolean);
    for (const id of ids) {
        await assertCanOperateRow(ctx, id);
    }
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    const operator = (ctx.state?.currentUser?.nickname
        || ctx.state?.currentUser?.username
        || 'nocoBase') as string;
    ctx.body = await connectorClient.returnOrderStatus({ ...body, operator });
    await next();
}

async function refresh(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderRefresh();
    await next();
}

function readId(ctx: Context) {
    const params = (ctx.action?.params || {}) as any;
    const body = (ctx.request.body || {}) as any;
    const values = params.values || {};
    return Number(values.id ?? body.id ?? ctx.query?.id);
}

async function canOperateRow(ctx: Context, id: number) {
    if (await isAssigner(ctx)) return true;
    const userId = Number(ctx.state?.currentUser?.id) || null;
    if (!userId) return true;
    const dataSource = (ctx.app.dataSourceManager as any).get('d_99cwsyi7q4k');
    const repository = dataSource?.collectionManager?.getRepository('LxReturnOrder');
    if (!repository) return true;
    const row = await repository.findOne({ filterByTk: id });
    const ownerId = Number(row?.get ? row.get('owner_id') : row?.owner_id) || 0;
    // 未指派的公共池：售后人员都可以处理
    return !ownerId || ownerId === userId;
}

async function assertCanOperateRow(ctx: Context, id: number) {
    if (!(await canOperateRow(ctx, id))) {
        ctx.throw(403, '只能操作自己负责的退货申请；他人负责的行请由主管操作');
    }
}

function operatorOf(ctx: Context) {
    return (ctx.state?.currentUser?.nickname
        || ctx.state?.currentUser?.username
        || 'nocoBase') as string;
}

async function refundGet(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderRefundGet(readId(ctx));
    await next();
}

async function refundSave(ctx: Context, next: Next) {
    await assertCanOperateRow(ctx, readId(ctx));
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    ctx.body = await connectorClient.returnOrderRefundSave(readId(ctx), { ...body, operator: operatorOf(ctx) });
    await next();
}

async function reshipGet(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderReshipGet(readId(ctx));
    await next();
}

async function reshipSave(ctx: Context, next: Next) {
    await assertCanOperateRow(ctx, readId(ctx));
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    ctx.body = await connectorClient.returnOrderReshipSave(readId(ctx), { ...body, operator: operatorOf(ctx) });
    await next();
}

async function orderFlag(ctx: Context, next: Next) {
    const params = (ctx.action?.params || {}) as any;
    const orderId = String(params.values?.order_id || ctx.query?.order_id || '').trim();
    ctx.body = await connectorClient.returnOrderFlag(orderId);
    await next();
}

async function workOrderGet(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderWorkOrderGet(readId(ctx));
    await next();
}

async function workOrderCreate(ctx: Context, next: Next) {
    await assertCanOperateRow(ctx, readId(ctx));
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    const user = ctx.state?.currentUser;
    if (user?.id && !body.owner_id) {
        body.owner_id = Number(user.id);
        body.owner_name = user.nickname || user.username || '';
    }
    ctx.body = await connectorClient.returnOrderWorkOrderCreate(readId(ctx), body);
    await next();
}

async function workOrderLink(ctx: Context, next: Next) {
    await assertCanOperateRow(ctx, readId(ctx));
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    ctx.body = await connectorClient.returnOrderWorkOrderLink(readId(ctx), body);
    await next();
}

async function trackingGet(ctx: Context, next: Next) {
    ctx.body = await connectorClient.returnOrderTrackingGet(readId(ctx));
    await next();
}

async function trackingAdd(ctx: Context, next: Next) {
    await assertCanOperateRow(ctx, readId(ctx));
    const params = (ctx.action?.params || {}) as any;
    const body = { ...(params.values || {}), ...(ctx.request.body || {}) };
    ctx.body = await connectorClient.returnOrderTrackingAdd(readId(ctx), body.items || [], body.remark);
    await next();
}

async function trackingRefresh(ctx: Context, next: Next) {
    const body = ctx.request.body || {};
    ctx.body = await connectorClient.returnOrderTrackingRefresh(Number(body.limit) || 20);
    await next();
}

export const RETURN_REQUEST_ACTIONS = {
    list,
    stats,
    assign,
    status,
    refresh,
    refundGet,
    refundSave,
    reshipGet,
    reshipSave,
    trackingGet,
    trackingAdd,
    trackingRefresh,
    orderFlag,
    workOrderGet,
    workOrderCreate,
    workOrderLink,
};
