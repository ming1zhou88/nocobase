/**
 * 7D4 快递异常的「指派」服务端拦截（补上原实现缺的四件事）
 *
 * 依据：doc/nocobase/检查-7D4快递异常实现现状-v1.md
 *
 * ── 为什么要在服务端拦 ────────────────────────────────────────
 * 主管在页面上把「售后处理人」改成某人时，原生 CRUD **只写 handler_name 一列**：
 *   · handler_id 保持 NULL → 行级隔离 scope `{handler_id: {{当前用户id}}}` 永不命中
 *                             → 被指派的售后负责人**看不到这条记录**（静默失效）
 *   · handle_status 仍是「待指派」、指派留痕全空
 *   · 负责人表不回写 → 邮件链路的自动派单命中率恒为 0
 *
 * 前端联动规则救不了：表格内联编辑 / 批量更新 / Excel 导入 / 直接调 API 都会绕过它。
 *
 * ── 怎么拦 ────────────────────────────────────────────────────
 * `dataSourceManager.use(...)` 注册的中间件，会被合并进**每个数据源**自己的
 * resourceManager（core/data-source-manager/src/data-source.ts 的 `middleware()`），
 * 所以这里能拿到外部数据源上的 write 动作。命中「改 handler_name」就转交连接器，
 * 由连接器在**同一事务**内完成：补 handler_id → 推进状态 → 留痕 → 回写负责人表。
 *
 * ── 为什么不改页面 ────────────────────────────────────────────
 * 拦截对页面完全透明：主管照旧在下拉里选人，行为不变，只是这次真的生效了。
 */
import type { Application } from '@nocobase/server';
import { connectorClient } from './services/connector-client';
import { isAssigner } from './after-sales-roles';

/** 外部数据源 key（power_automate = 本地/生产的 MySQL） */
const DATA_SOURCE_KEY = process.env.AFTER_SALES_TRACKING_DATA_SOURCE || 'd_99cwsyi7q4k';
/** 7D4 物化主表 */
const COLLECTION = process.env.AFTER_SALES_TRACKING_COLLECTION || 'TrackingException7D4Full';

/** 会写数据的动作（含批量） */
const WRITE_ACTIONS = new Set(['update', 'updateMany', 'updateOrCreate', 'firstOrCreate', 'create', 'createMany']);

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };

function pickActionMeta(ctx: any) {
  const action = ctx?.action || {};
  const params = action.params || {};
  return {
    dataSourceKey: ctx?.get?.('x-data-source') || 'main',
    resourceName: action.resourceName || params.resourceName,
    actionName: action.actionName || params.actionName,
    params,
  };
}

function normalizeTargets(params: any) {
  const { filterByTk, filter, values } = params || {};
  const rowIds: number[] = [];
  const orderIds: string[] = [];

  const pushId = (v: unknown) => {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) rowIds.push(n);
  };
  const pushOrder = (v: unknown) => {
    const t = String(v ?? '').trim();
    if (t) orderIds.push(t);
  };

  if (Array.isArray(filterByTk)) filterByTk.forEach(pushId);
  else if (filterByTk !== undefined && filterByTk !== null) pushId(filterByTk);

  // 批量更新走的是 filter；按平台订单筛选时把订单号取出来（责任人是平台订单粒度）
  if (filter && typeof filter === 'object') {
    const orderFilter = (filter as any)['order-id'];
    if (typeof orderFilter === 'string') pushOrder(orderFilter);
    else if (Array.isArray(orderFilter)) orderFilter.forEach(pushOrder);
    else if (orderFilter && typeof orderFilter === 'object' && Array.isArray((orderFilter as any).$in)) {
      (orderFilter as any).$in.forEach(pushOrder);
    }
    const idFilter = (filter as any).id;
    if (idFilter && typeof idFilter === 'object' && Array.isArray((idFilter as any).$in)) {
      (idFilter as any).$in.forEach(pushId);
    }
  }

  // 单据里如果直接给了订单号，也认
  if (values && typeof values === 'object') {
    pushOrder((values as any)['order-id']);
  }

  return { rowIds: [...new Set(rowIds)], orderIds: [...new Set(orderIds)] };
}

/** 把页面上的姓名解析成 NocoBase 用户（负责人下拉的 value 就是姓名） */
async function resolveUser(app: Application, name: string) {
  const repository = app.db.getRepository('users');
  const byNickname = await repository.findOne({ filter: { nickname: name } });
  if (byNickname) {
    return {
      id: Number(byNickname.get('id')),
      name: String(byNickname.get('nickname') || name),
      account: byNickname.get('username'),
    };
  }
  const byUsername = await repository.findOne({ filter: { username: name } });
  if (byUsername) {
    return {
      id: Number(byUsername.get('id')),
      name: String(byUsername.get('nickname') || name),
      account: byUsername.get('username'),
    };
  }
  return null;
}

/**
 * 安装拦截中间件。返回是否安装成功。
 * 在插件的 `load()` 里调用 —— 必须早于任何数据源被首次使用，
 * 因为数据源只在第一次 `middleware()` 时合并 dataSourceManager 的中间件。
 */
export function installTrackingExceptionAssign(app: Application, logger?: Logger): boolean {
  const manager = app.dataSourceManager as any;
  if (!manager?.use) {
    logger?.warn?.('[tracking-assign] dataSourceManager 不可用，跳过安装');
    return false;
  }

  manager.use(async (ctx: any, next: () => Promise<void>) => {
    const meta = pickActionMeta(ctx);
    if (
      meta.dataSourceKey !== DATA_SOURCE_KEY ||
      meta.resourceName !== COLLECTION ||
      !WRITE_ACTIONS.has(String(meta.actionName))
    ) {
      return next();
    }

    const values = meta.params?.values || {};
    const handlerName = String(values.handler_name ?? '').trim();
    // 没动「售后处理人」的写入照常走原生（补寄/退款/状态/备注等不受影响）
    if (!handlerName) {
      return next();
    }

    // ★ 命中后不调 next() = 绕过原生 CRUD 上的 ACL 行级 scope，必须自己判权限。
    //   漏了这一步时，任何能调 update 的人都能借这个中间件改派任意异常行。
    if (!(await isAssigner(ctx))) {
      ctx.throw(403, '只有售后主管可以指派/改派负责人');
      return;
    }

    const owner = await resolveUser(app, handlerName);
    if (!owner) {
      ctx.throw(400, `负责人「${handlerName}」在 NocoBase 用户里找不到（请检查昵称是否与下拉选项一致）`);
      return;
    }

    const targets = normalizeTargets(meta.params);
    if (!targets.rowIds.length && !targets.orderIds.length) {
      ctx.throw(400, '无法确定要指派哪一行（缺少 filterByTk / filter）');
      return;
    }

    const operator = ctx.state?.currentUser
      ? { id: Number(ctx.state.currentUser.id), name: ctx.state.currentUser.nickname || ctx.state.currentUser.username }
      : undefined;

    try {
      const result = await connectorClient.assignTrackingException({
        rowIds: targets.rowIds,
        orderIds: targets.orderIds,
        owner,
        operator,
        source: 'manual',
      });
      logger?.info?.(`[tracking-assign] ${result.updated} 行 → ${owner.name}`);
      // 拦截成功：不回 next()，避免原生 update 把 handler_name 再写一遍（会把状态覆盖回去）
      ctx.body = { data: { ...result, handler_id: owner.id, handler_name: owner.name, handle_status: '待处理' } };
    } catch (error: any) {
      logger?.error?.(`[tracking-assign] 失败: ${error?.message}`);
      ctx.throw(502, `指派失败：${error?.message || '连接器不可用'}`);
    }
  });

  logger?.info?.(`[tracking-assign] 已安装拦截：${DATA_SOURCE_KEY}.${COLLECTION}`);
  return true;
}

export { COLLECTION as TRACKING_EXCEPTION_COLLECTION, DATA_SOURCE_KEY as TRACKING_EXCEPTION_DATA_SOURCE };
