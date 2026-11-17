/**
 * 售后处理事项：审核、重新提交、编辑字段的受控接口。
 *
 * 数据在外部 MySQL 数据源 d_99cwsyi7q4k；权限和状态流转必须在这里校验，
 * 不能只依赖前端按钮隐藏。
 */
import type { Context, Next } from '@nocobase/actions';
import { currentRoleNames } from './after-sales-roles';

export const AFTER_SALES_REQUEST_RESOURCE = 'afterSalesRequest';
export const AFTER_SALES_REQUEST_COLLECTIONS: Record<string, string> = {
  'warehouse-contacts': 'AfterSalesWarehouseContact',
  'reship-requests': 'AfterSalesReshipRequest',
  'refund-requests': 'AfterSalesRefundRequest',
  'claim-requests': 'AfterSalesClaimRequest',
};

const REVIEW_ROLES = ['root', 'admin', 'after_sales_manager'];
const RESUBMIT_STATUSES = ['待复查', '待再议', '已拒绝'];
const PENDING_STATUS: Record<string, string> = {
  'reship-requests': '待审核',
  'refund-requests': '待审核',
};

const STATUS_FIELD: Record<string, string> = {
  'warehouse-contacts': 'contact_status',
  'reship-requests': 'request_status',
  'refund-requests': 'request_status',
  'claim-requests': 'claim_status',
};

const STATUS_FLOW: Record<string, Record<string, string[]>> = {
  'warehouse-contacts': {
    '待联系': ['联系中', '已发送', '已关闭'],
    '联系中': ['已发送', '已关闭'],
    '待发送': ['已发送', '已关闭'],
    '已发送': ['已回复', '已关闭'],
    '已回复': ['已关闭'],
  },
  'reship-requests': {
    '待审核': ['待复查', '已批准', '已拒绝'],
    '待复查': ['待审核', '已拒绝'],
    '已拒绝': ['待审核'],
    '已批准': ['执行中', '已取消'],
    '执行中': ['已完成', '已取消'],
  },
  'refund-requests': {
    '待审核': ['待再议', '已批准', '已拒绝'],
    '待再议': ['待审核', '已拒绝'],
    '已拒绝': ['待审核'],
    '已批准': ['执行中', '已取消'],
    '执行中': ['已完成', '已取消'],
  },
  'claim-requests': {
    '待提交': ['已提交', '已拒绝', '已关闭'],
    '已提交': ['处理中', '已拒绝', '已关闭'],
    '处理中': ['已索赔', '已拒绝', '已关闭'],
  },
};

const AGENT_WHITELIST: Record<string, string[]> = {
  'warehouse-contacts': ['issue_description', 'message_content', 'contact_channel', 'follow_up_at', 'platform_sku', 'stock_sku', 'warehouse_name', 'handler_name'],
  'reship-requests': ['reship_type', 'reship_item_sku', 'reship_item_name', 'quantity', 'reason', 'buyer_photos'],
  'refund-requests': ['refund_amount', 'refund_currency', 'reason', 'refund_photos'],
  'claim-requests': ['claim_amount', 'claim_currency', 'received_amount', 'claim_reason', 'claim_trigger', 'related_request_no', 'claim_packing_list', 'claim_email_evidence', 'claim_tracking_evidence', 'claim_other_evidence'],
};

function bodyOf(ctx: Context): any {
  const params = (ctx.action?.params || {}) as any;
  return { ...(params.values || {}), ...(ctx.request.body || {}), ...(ctx.query || {}) };
}

function repoOf(ctx: Context, collection: string) {
  const dataSource = (ctx.app.dataSourceManager as any).get('d_99cwsyi7q4k');
  return dataSource?.collectionManager?.getRepository(collection);
}

async function rolesOf(ctx: Context): Promise<string[]> {
  return currentRoleNames(ctx);
}

async function canReview(ctx: Context) {
  return (await rolesOf(ctx)).some((role) => REVIEW_ROLES.includes(role));
}

function assertRequestType(type: string) {
  if (!AFTER_SALES_REQUEST_COLLECTIONS[type]) throw new Error('invalid request_type');
}

function statusField(type: string) {
  return STATUS_FIELD[type];
}

async function audit(ctx: Context, type: string, requestId: number, platformOrderId: string, fromStatus: string, toStatus: string, action: string, note: string) {
  const repo = repoOf(ctx, 'AfterSalesRequestAuditLog');
  if (!repo) return;
  const user = ctx.state?.currentUser;
  try {
    await repo.create({
      values: {
        request_type: type,
        request_id: requestId,
        platform_order_id: platformOrderId || null,
        from_status: fromStatus || null,
        to_status: toStatus || null,
        action,
        reviewer_id: user?.id ? String(user.id) : null,
        reviewer_name: user?.nickname || user?.username || null,
        note: note || null,
      },
    });
  } catch {
    // 审核日志失败不应阻断主业务；由页面提示和后续对账发现
  }
}

async function create(ctx: Context, next: Next) {
  const body = bodyOf(ctx);
  const type = String(body.request_type || '');
  assertRequestType(type);
  const values = body.values && typeof body.values === 'object' ? body.values : body;
  if (!values.platform_order_id) ctx.throw(400, '缺少平台订单编号');
  const repo = repoOf(ctx, AFTER_SALES_REQUEST_COLLECTIONS[type]);
  if (!repo) ctx.throw(500, '数据源不可用');
  const user = ctx.state?.currentUser;
  const name = user?.nickname || user?.username || '人工';
  const defaults: Record<string, any> = {
    platform_order_id: values.platform_order_id,
    source_type: values.source_type || 'tracking_exception',
    exception_id: values.exception_id || null,
    source_row_id: values.source_row_id || null,
    platform_sku: values.platform_sku || null,
    stock_sku: values.stock_sku || null,
    sub_order_id: values.sub_order_id || null,
    tracking_number: values.tracking_number || null,
    store_name: values.store_name || null,
    warehouse_name: values.warehouse_name || null,
    handler_id: user?.id || values.handler_id || null,
    handler_name: name || values.handler_name || null,
    created_by: name,
  };
  const allowed = new Set([...Object.keys(defaults), ...(AGENT_WHITELIST[type] || [])]);
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(values, key)) defaults[key] = values[key];
  defaults[STATUS_FIELD[type]] = values[STATUS_FIELD[type]] || ({ 'warehouse-contacts': '待发送', 'reship-requests': '待审核', 'refund-requests': '待审核', 'claim-requests': '待提交' } as any)[type];
  const record = await repo.create({ values: defaults });
  await audit(ctx, type, Number(record.get('id')), String(defaults.platform_order_id), '', String(defaults[STATUS_FIELD[type]]), 'create', '');
  ctx.body = { data: record.toJSON ? record.toJSON() : record };
  await next();
}

async function review(ctx: Context, next: Next) {
  const requestType = String(bodyOf(ctx).request_type || '');
  const noReviewType = ['warehouse-contacts', 'claim-requests'].includes(requestType);
  if (!noReviewType && !(await canReview(ctx))) ctx.throw(403, '只有售后主管或管理员可以审核');
  const body = bodyOf(ctx);
  const type = String(body.request_type || '');
  assertRequestType(type);
  const id = Number(body.id);
  if (!id) ctx.throw(400, '缺少申请 id');
  const nextStatus = String(body.next_status || '');
  if (!nextStatus) ctx.throw(400, '缺少目标状态');
  const repo = repoOf(ctx, AFTER_SALES_REQUEST_COLLECTIONS[type]);
  if (!repo) ctx.throw(500, '数据源不可用');
  const record = await repo.findOne({ filterByTk: id });
  if (!record) ctx.throw(404, '申请不存在');
  const field = statusField(type);
  const fromStatus = String(record.get(field) || '');
  if (!nextStatus || nextStatus === fromStatus) ctx.throw(400, '目标状态不能与当前状态相同');
  const allowed = STATUS_FLOW[type]?.[fromStatus] || [];
  if (!allowed.includes(nextStatus)) ctx.throw(400, `不允许从 ${fromStatus} 流转到 ${nextStatus}`);
  const user = ctx.state?.currentUser;
  const values: Record<string, any> = {
    [field]: nextStatus,
    review_note: body.review_note || null,
    reviewer_id: user?.id ? String(user.id) : null,
    reviewed_at: new Date(),
  };
  if (body.patch && typeof body.patch === 'object') Object.assign(values, body.patch);
  await repo.update({ filterByTk: id, values });
  await audit(ctx, type, id, String(record.get('platform_order_id') || ''), fromStatus, nextStatus, 'review', String(body.review_note || ''));
  ctx.body = { data: { id, from_status: fromStatus, to_status: nextStatus } };
  await next();
}

async function resubmit(ctx: Context, next: Next) {
  const body = bodyOf(ctx);
  const type = String(body.request_type || '');
  assertRequestType(type);
  if (!PENDING_STATUS[type]) ctx.throw(400, '该类型不支持重新提交审核');
  const id = Number(body.id);
  const repo = repoOf(ctx, AFTER_SALES_REQUEST_COLLECTIONS[type]);
  if (!repo) ctx.throw(500, '数据源不可用');
  const record = await repo.findOne({ filterByTk: id });
  if (!record) ctx.throw(404, '申请不存在');
  const field = statusField(type);
  const fromStatus = String(record.get(field) || '');
  if (!RESUBMIT_STATUSES.includes(fromStatus)) ctx.throw(400, `当前状态 ${fromStatus} 不能重新提交`);
  const user = ctx.state?.currentUser;
  if (!(await canReview(ctx))) {
    const owner = String(record.get('handler_name') || record.get('created_by') || '');
    if (!user?.id || (owner && owner !== (user.nickname || user.username))) ctx.throw(403, '只能重新提交自己负责的申请');
  }
  const values: Record<string, any> = { [field]: PENDING_STATUS[type], review_note: null, reviewer_id: null, reviewed_at: null };
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
  for (const key of AGENT_WHITELIST[type] || []) if (Object.prototype.hasOwnProperty.call(patch, key)) values[key] = patch[key];
  await repo.update({ filterByTk: id, values });
  await audit(ctx, type, id, String(record.get('platform_order_id') || ''), fromStatus, PENDING_STATUS[type], 'resubmit', String(body.review_note || ''));
  ctx.body = { data: { id, from_status: fromStatus, to_status: PENDING_STATUS[type] } };
  await next();
}

async function update(ctx: Context, next: Next) {
  const body = bodyOf(ctx);
  const type = String(body.request_type || '');
  assertRequestType(type);
  const id = Number(body.id);
  const repo = repoOf(ctx, AFTER_SALES_REQUEST_COLLECTIONS[type]);
  if (!repo) ctx.throw(500, '数据源不可用');
  const record = await repo.findOne({ filterByTk: id });
  if (!record) ctx.throw(404, '申请不存在');
  const field = statusField(type);
  const status = String(record.get(field) || '');
  const isReviewer = await canReview(ctx);
  if (Object.prototype.hasOwnProperty.call(body.values || {}, field)) ctx.throw(400, '状态只能通过审核或重新提交接口修改');
  if (!isReviewer) {
    if (!['待复查', '待再议', '已拒绝'].includes(status) && !['warehouse-contacts', 'claim-requests'].includes(type)) {
      ctx.throw(403, '当前状态不允许售后人员修改');
    }
    const values: Record<string, any> = {};
    for (const key of AGENT_WHITELIST[type] || []) if (Object.prototype.hasOwnProperty.call(body.values || {}, key)) values[key] = body.values[key];
    if (!Object.keys(values).length) ctx.throw(403, '没有可修改字段');
    await repo.update({ filterByTk: id, values });
  } else {
    await repo.update({ filterByTk: id, values: body.values || {} });
  }
  ctx.body = { data: { id } };
  await next();
}

export const AFTER_SALES_REQUEST_ACTIONS = { create, review, resubmit, update };
