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
import { isAssigner } from './after-sales-roles';

/**
 * 把 Date 格式化成**本地时区**的 `YYYY-MM-DD HH:mm:ss`（外部 MySQL DATETIME 用）。
 *
 * 实测：NocoBase 对外部数据源的 datetimeNoTz 字段，写入时按「本地→UTC」减 8 小时、
 * 读取时再「UTC→本地」加 8 小时。因此写入本地时间字符串可以原样往返；
 * 直接传 Date 会多走一次换算，列表时间会偏成 UTC。
 */
function toLocalDateTimeString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export async function createDailyAfterSalesWorkOrder(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dailyOrderId = Number(values.daily_order_id ?? values.dailyOrderId ?? ctx.action.params?.filterByTk);
  if (!Number.isInteger(dailyOrderId) || dailyOrderId <= 0) {
    ctx.throw(400, 'daily_order_id is required');
  }
  // 专员只能从自己负责的每日行发起工单（与草稿读写同一口径）
  await loadDraftRowForUser(ctx, dailyOrderId, '发起工单');

  ctx.body = await connectorClient.createDailyAfterSalesWorkOrder({
    daily_order_id: dailyOrderId,
    overrides: (values.overrides as Record<string, unknown>) || undefined,
    force: Boolean(values.force),
  });

  await next();
}

/**
 * 批量指派：给每日售后订单的多行设置同一个负责人。
 *
 * 这是备用入口：NocoBase 原生「批量编辑」实际走 update + filter，
 * 页面原生按钮可以直接用；本 action 供需要显式 rowIds 的调用方使用。
 * 业务事务仍由 Connector 完成。
 */
export async function batchAssignDailyAfterSales(ctx: Context, next: Next) {
  if (!(await isAssigner(ctx))) {
    ctx.throw(403, '只有售后主管可以批量指派');
  }

  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const ownerName = String(values.owner_name ?? values.ownerName ?? '').trim();
  if (!ownerName) {
    ctx.throw(400, 'owner_name is required');
  }

  const rowIds = (Array.isArray(values.rowIds) ? values.rowIds : [values.rowIds])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const identityKeys = (Array.isArray(values.identityKeys) ? values.identityKeys : [values.identityKeys])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  if (!rowIds.length && !identityKeys.length) {
    ctx.throw(400, 'rowIds or identityKeys is required');
  }

  const users = ctx.app.db.getRepository('users');
  const user =
    (await users.findOne({ filter: { nickname: ownerName } })) ||
    (await users.findOne({ filter: { username: ownerName } }));
  if (!user) {
    ctx.throw(400, `负责人「${ownerName}」在 NocoBase 用户里找不到`);
  }

  const operator = ctx.state?.currentUser
    ? {
        id: Number(ctx.state.currentUser.id),
        name: ctx.state.currentUser.nickname || ctx.state.currentUser.username,
      }
    : undefined;

  const result = await connectorClient.assignDailyAfterSalesOrder({
    rowIds,
    identityKeys,
    owner: {
      id: Number(user.get('id')),
      name: String(user.get('nickname') || ownerName),
      account: user.get('username'),
    },
    operator,
    source: 'manual',
  });

  ctx.body = {
    success: true,
    ...result,
    owner_id: Number(user.get('id')),
    owner_name: String(user.get('nickname') || ownerName),
    assign_status: '已指派',
  };
  await next();
}

/** 草稿 JSON 上限（字符数，约 64KB）：防止超大 payload 拖慢列表/响应。 */
const DRAFT_MAX_CHARS = 64 * 1024;

/** 读每日行，并校验当前用户是否有权访问该行草稿（本人或售后主管）。 */
async function loadDraftRowForUser(ctx: Context, dailyOrderId: number, actionLabel: string) {
  const dataSource = (ctx.app.dataSourceManager as any).get('d_99cwsyi7q4k');
  const repository = dataSource?.collectionManager?.getRepository('DailyAfterSalesOrder');
  if (!repository) {
    ctx.throw(500, 'DailyAfterSalesOrder repository unavailable');
  }
  const row = await repository.findOne({ filterByTk: dailyOrderId });
  if (!row) {
    ctx.throw(404, `每日售后订单 #${dailyOrderId} 不存在`);
  }
  const user = ctx.state?.currentUser;
  // 无登录态（内部任务/系统调用）不在这里判；前端调用必须本人或主管。
  if (user?.id) {
    const assigner = await isAssigner(ctx);
    const ownerId = Number(row.owner_id ?? row.get?.('owner_id'));
    if (!assigner && ownerId !== Number(user.id)) {
      ctx.throw(403, `只能${actionLabel}自己负责的每日售后订单草稿`);
    }
  }
  return { row, repository, user };
}

/** 保存每日售后订单的工单草稿：直接写外部 MySQL 数据源，绕过原生 update 的字段限制。 */
export async function saveDailyAfterSalesDraft(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dailyOrderId = Number(values.daily_order_id ?? values.dailyOrderId);
  if (!Number.isInteger(dailyOrderId) || dailyOrderId <= 0) {
    ctx.throw(400, 'daily_order_id is required');
  }
  const payload = values.payload && typeof values.payload === 'object' ? values.payload : {};

  const serialized = JSON.stringify(payload);
  if (serialized.length > DRAFT_MAX_CHARS) {
    ctx.throw(400, `草稿内容过大（${serialized.length} 字符），上限 ${DRAFT_MAX_CHARS}`);
  }

  const { row, repository, user } = await loadDraftRowForUser(ctx, dailyOrderId, '保存');

  // 并发控制：客户端带上打开弹窗时的版本号，与库里不一致说明别人已经改过。
  const currentVersion = Number(row.draft_version ?? row.get?.('draft_version') ?? 0);
  const expectedRaw = values.expected_version ?? values.expectedVersion;
  if (expectedRaw !== undefined && expectedRaw !== null && String(expectedRaw).trim() !== '') {
    const expected = Number(expectedRaw);
    if (!Number.isInteger(expected) || expected !== currentVersion) {
      ctx.throw(409, `草稿已被他人更新（当前版本 ${currentVersion}），请重新打开后再保存`);
    }
  }

  const version = currentVersion + 1;
  await repository.update({
    filterByTk: dailyOrderId,
    values: {
      draft_payload: payload,
      // 外部 MySQL 的 DATETIME 由 NocoBase 按「本地→UTC」写入、按实例时区读出；
      // 直接传 Date 会多换算一次（实测偏 8 小时），这里写本地时间字符串，可原样往返。
      draft_saved_at: toLocalDateTimeString(new Date()),
      draft_saved_by: user?.nickname || user?.username || null,
      has_draft: true,
      draft_version: version,
    },
  });
  ctx.body = { success: true, dailyOrderId, version };
  await next();
}

/** 读取每日售后订单的工单草稿。 */
export async function getDailyAfterSalesDraft(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const dailyOrderId = Number(values.daily_order_id ?? values.dailyOrderId);
  if (!Number.isInteger(dailyOrderId) || dailyOrderId <= 0) {
    ctx.throw(400, 'daily_order_id is required');
  }
  const { row } = await loadDraftRowForUser(ctx, dailyOrderId, '查看');
  ctx.body = {
    dailyOrderId,
    draft: row?.get?.('draft_payload') ?? row?.draft_payload ?? null,
    hasDraft: Boolean(row?.get?.('has_draft') ?? row?.has_draft),
    version: row?.get?.('draft_version') ?? row?.draft_version ?? null,
  };
  await next();
}

/** 批量返回每日行的草稿状态（旧环境兜底；未授权行不出现在结果里）。 */
export async function listDailyDraftStates(ctx: Context, next: Next) {
  const values = (ctx.action.params?.values || ctx.request.body || {}) as Record<string, unknown>;
  const ids = (Array.isArray(values.daily_order_ids) ? values.daily_order_ids : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    ctx.body = { drafts: {} };
    await next();
    return;
  }
  const dataSource = (ctx.app.dataSourceManager as any).get('d_99cwsyi7q4k');
  const repository = dataSource?.collectionManager?.getRepository('DailyAfterSalesOrder');
  if (!repository) ctx.throw(500, 'DailyAfterSalesOrder repository unavailable');
  const rows = await repository.find({
    filter: { id: { $in: ids } },
    fields: ['id', 'owner_id', 'has_draft', 'draft_payload', 'draft_saved_at', 'draft_saved_by', 'draft_version'],
  });
  const user = ctx.state?.currentUser;
  const assigner = user?.id ? await isAssigner(ctx) : true;
  const visible = (rows || []).filter((row: any) => {
    if (assigner) return true;
    return Number(row.owner_id ?? row.get?.('owner_id')) === Number(user.id);
  });
  const drafts = Object.fromEntries(
    visible.map((row: any) => [
      String(row.id ?? row.get?.('id')),
      {
        has_draft:
          Boolean(row.draft_payload ?? row.get?.('draft_payload')) || Boolean(row.has_draft ?? row.get?.('has_draft')),
        saved_at: row.draft_saved_at ?? row.get?.('draft_saved_at') ?? null,
        saved_by: row.draft_saved_by ?? row.get?.('draft_saved_by') ?? null,
        version: row.draft_version ?? row.get?.('draft_version') ?? null,
      },
    ]),
  );
  ctx.body = { drafts };
  await next();
}

export const DAILY_AFTER_SALES_RESOURCE = 'dailyAfterSales';
export const DAILY_AFTER_SALES_ACTIONS = {
  createWorkOrder: createDailyAfterSalesWorkOrder,
  batchAssign: batchAssignDailyAfterSales,
  saveDraft: saveDailyAfterSalesDraft,
  getDraft: getDailyAfterSalesDraft,
  listDraftStates: listDailyDraftStates,
};
