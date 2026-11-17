/**
 * 确认订单工作台（OrderInfoToConfirm 附表）
 *
 * 背景：
 *   原 7E4 `ConfirmationOrderInfo7E4` 保持不动；本文件服务的是新建的“任务化附表”
 *   `OrderInfoToConfirm`（见 sql/OrderInfoToConfirm.sql）。
 *   附表在原订单字段之外，增加了指派（assignee_*）、处理状态（handle_status）、
 *   处理标记（handle_mark）、处理备注、导入批次/时间等任务字段。
 *
 * 设计口径：
 *   - 数据在外部 MySQL 数据源（与每日售后订单同一套连接），页面走本文件的薄接口；
 *   - 指派权限：售后主管 / 管理员 / 售后值班角色，或当天在 `after_sales_duty_roster` 值班的人；
 *   - 处理状态与标记：指派人可改任意行；专员只能改“负责人=自己”的行；
 *   - 导表按 biz_key 幂等 upsert：更新业务字段，不覆盖已有的指派/处理结果。
 */
import type { Context, Next } from '@nocobase/actions';
import { currentRoleNames } from './after-sales-roles';

const DATA_SOURCE_KEY = process.env.ORDER_CONFIRM_DATA_SOURCE || 'd_99cwsyi7q4k';
const COLLECTION = process.env.ORDER_CONFIRM_COLLECTION || 'OrderInfoToConfirm';

/** 具备分配（指派）权限的角色 */
const ASSIGN_ROLES = ['admin', 'root', 'after_sales_manager', 'after_sales_duty'];

export const HANDLE_STATUS_OPTIONS = ['未处理', '待跟踪', '已处理'] as const;

/** 需求给定的 6 个处理标记（顺序即页面下拉顺序） */
export const HANDLE_MARK_OPTIONS = [
  '已发手工咨询',
  '顾客已确认原样发货',
  '顾客已确认修改发货',
  '确认未果原样发货',
  '确认未果修改发货',
  '取消订单',
] as const;

/** 可导入、可在页面上编辑的业务字段（任务字段不参与覆盖） */
const BUSINESS_FIELDS = [
  'platform_order_id',
  'platform_sub_order_id',
  'origin_order_id',
  'shop_name',
  'order_status',
  'sub_order_status',
  'purchase_date',
  'payments_date',
  'buyer_email',
  'buyer_phone',
  'recipient_name',
  'ship_address_1',
  'ship_address_2',
  'ship_city',
  'ship_state',
  'ship_postal_code',
  'sku',
  'quantity_purchased',
  'item_price',
  'category',
  'wicker_color',
  'cushion_color',
  'priority_of_shipment',
  'order_remark',
];

/** 各文本列长度上限（与 sql/OrderInfoToConfirm.sql 对齐，避免导入时被 MySQL 严格模式拒绝） */
const FIELD_LIMITS: Record<string, number> = {
  platform_order_id: 64,
  platform_sub_order_id: 64,
  origin_order_id: 64,
  shop_name: 100,
  order_status: 64,
  sub_order_status: 64,
  buyer_email: 255,
  buyer_phone: 50,
  recipient_name: 100,
  ship_address_1: 255,
  ship_address_2: 255,
  ship_city: 100,
  ship_state: 100,
  ship_postal_code: 20,
  sku: 100,
  category: 100,
  wicker_color: 50,
  cushion_color: 50,
  priority_of_shipment: 50,
  order_remark: 500,
};

const DATETIME_FIELDS = new Set(['purchase_date', 'payments_date']);
const NUMBER_FIELDS = new Set(['quantity_purchased', 'item_price']);

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** 本地时区 `YYYY-MM-DD HH:mm:ss`（外部 MySQL DATETIME 一律按本地时间字符串写） */
function localDateTime(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function plain(row: any) {
  if (!row) return row;
  if (typeof row.toJSON === 'function') return row.toJSON();
  return row;
}

function readValues(ctx: Context): Record<string, any> {
  return ((ctx.action.params?.values || ctx.request.body || {}) as Record<string, any>) || {};
}

function getRepository(ctx: Context) {
  const dataSource = (ctx.app.dataSourceManager as any).get(DATA_SOURCE_KEY);
  const repository = dataSource?.collectionManager?.getRepository(COLLECTION);
  if (!repository) {
    ctx.throw(500, `数据表 ${COLLECTION} 不可用（数据源 ${DATA_SOURCE_KEY} 未加载）`);
  }
  return repository;
}

function currentUser(ctx: Context) {
  return ctx.state?.currentUser;
}

function userName(user: any) {
  return String(user?.nickname || user?.username || user?.id || '');
}

/** 当前用户是否值班（按 after_sales_duty_roster 当天的记录判断） */
async function isOnDutyToday(ctx: Context, userId: number) {
  try {
    const repository = ctx.app.db.getRepository('after_sales_duty_roster');
    const day = localDate();
    const count = await repository.count({
      filter: {
        dutyUserId: userId,
        start_date: { $lte: `${day} 23:59:59` },
        end_date: { $gte: `${day} 00:00:00` },
      },
    });
    return Number(count) > 0;
  } catch {
    return false;
  }
}

/** 是否拥有“分配任务”权限：主管/管理员/值班角色，或今天在值班表上 */
export async function canAssign(ctx: Context) {
  const user = currentUser(ctx);
  if (!user?.id) return false;
  const roles = await currentRoleNames(ctx);
  if (roles.some((role) => ASSIGN_ROLES.includes(role))) return true;
  return isOnDutyToday(ctx, Number(user.id));
}

async function assertAssigner(ctx: Context) {
  if (!(await canAssign(ctx))) {
    ctx.throw(403, '只有值班人员/售后主管可以分配任务');
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).replace(/[,¥$￥\s]/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * 解析导入日期：支持 `YYYY-MM-DD`、`YYYY/M/D H:mm`、ISO 串、Excel 日期序列号（数字）。
 * 统一输出本地时间字符串；解析不了返回 null。
 */
function normalizeDateTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateTime(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel 1900 日期系统：25569 = 1970-01-01
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return localDateTime(date);
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  // 纯数字（Excel 序列号以文本形式出现）
  if (/^\d{5}(\.\d+)?$/.test(text)) return normalizeDateTime(Number(text));
  const parsed = new Date(text.replace(/\//g, '-').replace(' ', 'T'));
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
    return localDateTime(parsed);
  }
  // 只有日期没有时间
  const dateOnly = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dateOnly) {
    return `${dateOnly[1]}-${pad(Number(dateOnly[2]))}-${pad(Number(dateOnly[3]))} 00:00:00`;
  }
  return null;
}

function buildBizKey(row: Record<string, any>): string {
  const sub = String(row.platform_sub_order_id || '').trim();
  const order = String(row.platform_order_id || row.origin_order_id || '').trim();
  return sub || order;
}

/** 把导入行收敛成只含业务字段的对象 */
function normalizeImportRow(input: Record<string, any>) {
  const output: Record<string, any> = {};
  for (const field of BUSINESS_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (DATETIME_FIELDS.has(field)) {
      const value = normalizeDateTime(raw);
      if (value) output[field] = value;
      continue;
    }
    if (NUMBER_FIELDS.has(field)) {
      const value = toNumber(raw);
      if (value !== null) output[field] = value;
      continue;
    }
    const text = String(raw).trim();
    const limit = FIELD_LIMITS[field];
    output[field] = (limit ? text.slice(0, limit) : text) || null;
  }
  // 7E4 导出里平台订单号常叫 orderItem_originOrderId：缺平台订单号时用它兜底，
  // 避免页面上“平台订单编号”列空着、也避免只能靠原始字段过滤。
  if (!output.platform_order_id && output.origin_order_id) output.platform_order_id = output.origin_order_id;
  const bizKey = String(input.biz_key || '').trim() || buildBizKey(output);
  if (!bizKey) return null;
  output.biz_key = bizKey.slice(0, 160);
  return output;
}

function buildFilter(filters: Record<string, any>) {
  const filter: Record<string, any> = {};
  const text = (value: unknown) => String(value ?? '').trim();

  if (text(filters.platformOrderId)) filter.platform_order_id = { $includes: text(filters.platformOrderId) };
  if (text(filters.subOrderId)) filter.platform_sub_order_id = { $includes: text(filters.subOrderId) };
  if (text(filters.buyerEmail)) filter.buyer_email = { $includes: text(filters.buyerEmail) };
  if (text(filters.sku)) filter.sku = { $includes: text(filters.sku) };
  if (text(filters.handleStatus)) filter.handle_status = text(filters.handleStatus);
  if (text(filters.handleMark)) filter.handle_mark = text(filters.handleMark);
  if (text(filters.assigneeId) === 'unassigned') filter.assignee_id = { $empty: true };
  else if (text(filters.assigneeId)) filter.assignee_id = Number(filters.assigneeId);

  const purchaseRange: Record<string, string> = {};
  if (text(filters.purchaseStart)) purchaseRange.$gte = text(filters.purchaseStart);
  if (text(filters.purchaseEnd)) purchaseRange.$lte = text(filters.purchaseEnd);
  if (Object.keys(purchaseRange).length) filter.purchase_date = purchaseRange;

  const importRange: Record<string, string> = {};
  if (text(filters.importStart)) importRange.$gte = text(filters.importStart);
  if (text(filters.importEnd)) importRange.$lte = text(filters.importEnd);
  if (Object.keys(importRange).length) filter.imported_at = importRange;

  return filter;
}

/** 列表 + 顶部统计 */
export async function listOrderConfirm(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const repository = getRepository(ctx);
  const page = Math.max(1, Number(values.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(values.pageSize) || 50));
  const filters = values.filters || {};
  const filter = buildFilter(filters);

  const sort = Array.isArray(values.sort) && values.sort.length ? values.sort : ['-imported_at', '-id'];
  const [rows, total] = await Promise.all([
    repository.find({ filter, sort, offset: (page - 1) * pageSize, limit: pageSize }),
    repository.count({ filter }),
  ]);

  // 顶部统计：以当前筛选（不含处理状态）为口径，分别统计三个状态与未指派
  const base = { ...filter };
  delete base.handle_status;
  delete base.handle_mark;
  const [pending, tracking, handled, unassigned] = await Promise.all([
    repository.count({ filter: { ...base, handle_status: '未处理' } }),
    repository.count({ filter: { ...base, handle_status: '待跟踪' } }),
    repository.count({ filter: { ...base, handle_status: '已处理' } }),
    repository.count({ filter: { ...base, assignee_id: { $empty: true } } }),
  ]);

  const canAssignNow = await canAssign(ctx);
  ctx.body = {
    rows: (rows || []).map(plain),
    total: Number(total) || 0,
    page,
    pageSize,
    stats: {
      total: Number(total) || 0,
      pending: Number(pending) || 0,
      tracking: Number(tracking) || 0,
      handled: Number(handled) || 0,
      unassigned: Number(unassigned) || 0,
    },
    me: {
      userId: Number(currentUser(ctx)?.id) || null,
      name: userName(currentUser(ctx)),
      canAssign: canAssignNow,
    },
  };
  await next();
}

/** 当前用户能力（页面初始化用） */
export async function orderConfirmMe(ctx: Context, next: Next) {
  const user = currentUser(ctx);
  ctx.body = {
    userId: Number(user?.id) || null,
    name: userName(user),
    roles: await currentRoleNames(ctx),
    canAssign: await canAssign(ctx),
  };
  await next();
}

/** 批量指派 */
export async function assignOrderConfirm(ctx: Context, next: Next) {
  await assertAssigner(ctx);
  const values = readValues(ctx);
  const ids = (Array.isArray(values.ids) ? values.ids : [values.ids])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) ctx.throw(400, 'ids is required');

  const assigneeId = Number(values.assigneeId);
  if (!Number.isInteger(assigneeId) || assigneeId <= 0) ctx.throw(400, 'assigneeId is required');
  const user = await ctx.app.db.getRepository('users').findOne({ filterByTk: assigneeId });
  if (!user) ctx.throw(400, `用户 #${assigneeId} 不存在`);
  const assigneeName = userName(user);

  const repository = getRepository(ctx);
  const [updated] = await repository.update({
    filter: { id: { $in: ids } },
    values: {
      assignee_id: assigneeId,
      assignee_name: assigneeName,
      assign_status: '已指派',
      assigned_at: localDateTime(),
      assigned_by: userName(currentUser(ctx)),
    },
  });

  ctx.body = { success: true, updated: Number(updated) || ids.length, assigneeId, assigneeName };
  await next();
}

/** 更新处理状态 / 处理标记 / 备注（支持批量） */
export async function updateOrderConfirm(ctx: Context, next: Next) {
  const values = readValues(ctx);
  const ids = (Array.isArray(values.ids) ? values.ids : [values.ids])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) ctx.throw(400, 'ids is required');

  const patch: Record<string, any> = {};
  if (values.handleStatus !== undefined) {
    const status = String(values.handleStatus || '').trim();
    if (!HANDLE_STATUS_OPTIONS.includes(status as any)) {
      ctx.throw(400, `handleStatus 必须是 ${HANDLE_STATUS_OPTIONS.join(' / ')}`);
    }
    patch.handle_status = status;
    if (status === '已处理') {
      patch.handled_at = localDateTime();
      patch.handled_by = userName(currentUser(ctx));
    } else {
      // 从“已处理”退回未处理/待跟踪时，清掉处理时间与处理人
      patch.handled_at = null;
      patch.handled_by = null;
    }
  }
  if (values.handleMark !== undefined) {
    const mark = String(values.handleMark || '').trim();
    if (mark && !HANDLE_MARK_OPTIONS.includes(mark as any)) {
      ctx.throw(400, `handleMark 不合法（可选：${HANDLE_MARK_OPTIONS.join(' / ')}）`);
    }
    patch.handle_mark = mark || null;
  }
  if (values.handleNote !== undefined) {
    patch.handle_note = String(values.handleNote || '').trim().slice(0, 1000) || null;
  }
  if (!Object.keys(patch).length) ctx.throw(400, '没有要更新的字段');

  const repository = getRepository(ctx);
  const user = currentUser(ctx);
  if (!user?.id) ctx.throw(401, 'login required');

  if (!(await canAssign(ctx))) {
    const rows = await repository.find({ filter: { id: { $in: ids } }, fields: ['id', 'assignee_id'] });
    const notMine = (rows || []).filter((row: any) => Number(plain(row).assignee_id) !== Number(user.id));
    if (notMine.length) {
      ctx.throw(403, '只能更新指派给自己的任务');
    }
  }

  const [updated] = await repository.update({ filter: { id: { $in: ids } }, values: patch });
  ctx.body = { success: true, updated: Number(updated) || ids.length, values: patch };
  await next();
}

/**
 * 导表（Excel 解析在前端完成，本接口只接收规范化后的行）。
 * 按 biz_key 幂等：存在则更新业务字段，不存在则插入；不覆盖指派/处理结果。
 */
export async function importOrderConfirm(ctx: Context, next: Next) {
  await assertAssigner(ctx);
  const values = readValues(ctx);
  const inputRows = Array.isArray(values.rows) ? values.rows : [];
  if (!inputRows.length) ctx.throw(400, 'rows is required');
  if (inputRows.length > 5000) ctx.throw(400, '单次最多导入 5000 行');

  const rows: Record<string, any>[] = [];
  const errors: Array<{ index: number; message: string }> = [];
  inputRows.forEach((input: Record<string, any>, index: number) => {
    try {
      const row = normalizeImportRow(input || {});
      if (!row) {
        errors.push({ index, message: '缺少平台订单编号/子订单编号，无法生成业务键' });
        return;
      }
      rows.push(row);
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  });

  if (!rows.length) {
    ctx.body = { success: false, inserted: 0, updated: 0, errors };
    await next();
    return;
  }

  const repository = getRepository(ctx);
  const model = (repository as any).model;
  const keys = rows.map((row) => row.biz_key);
  const existing: any[] = [];
  for (let index = 0; index < keys.length; index += 500) {
    const slice = keys.slice(index, index + 500);
    const found = await repository.find({ filter: { biz_key: { $in: slice } }, fields: ['biz_key'] });
    existing.push(...(found || []));
  }
  const existingKeys = new Set(existing.map((row: any) => String(plain(row).biz_key)));

  const now = localDateTime();
  const batch = String(values.batch || '').trim() || `IMPORT-${now.replace(/[-: ]/g, '')}`;
  const prepared = rows.map((row) => ({
    ...row,
    import_batch: batch,
    last_import_at: now,
    source: 'excel',
  }));

  // updateOnDuplicate：只覆盖业务字段 + 导入批次/最近导入时间，保留 imported_at / 指派 / 处理结果
  const updateFields = [...BUSINESS_FIELDS, 'import_batch', 'last_import_at', 'source'];
  await model.bulkCreate(prepared, { updateOnDuplicate: updateFields });

  const inserted = prepared.filter((row) => !existingKeys.has(String((row as any).biz_key))).length;
  const updated = prepared.length - inserted;
  ctx.body = {
    success: true,
    batch,
    inserted,
    updated,
    total: prepared.length,
    skipped: inputRows.length - prepared.length,
    errors,
  };
  await next();
}

export const ORDER_CONFIRM_RESOURCE = 'orderConfirm';
export const ORDER_CONFIRM_ACTIONS = {
  list: listOrderConfirm,
  me: orderConfirmMe,
  assign: assignOrderConfirm,
  updateTask: updateOrderConfirm,
  importRows: importOrderConfirm,
};
