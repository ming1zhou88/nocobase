/**
 * 每日售后订单表的「指派」服务端拦截
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * 工作台上的「售后负责人」列是**内联可编辑**的（`editable: true`），主管就是靠它指派。
 * 但原生 CRUD 只写 `owner_name` 一列，实测（2026-10-13）：
 *
 *     主管内联改 owner_name → HTTP 200，DB owner_name='许小菁'
 *     但 owner_id 仍是 NULL、assign_status 仍是「未指派」
 *     → 许小菁登录后**看不到这一行**（专员 scope 是 `owner_id = {{当前用户id}}`）
 *
 * 也就是"指派成功了，但被指派的人看不到"—— 页面不报错、HTTP 200。
 * 这和 7D4 那张表当年踩的是同一个坑（见 tracking-exception-assign.ts），
 * 每日表当时漏了对应的拦截。
 *
 * ── 怎么拦 ────────────────────────────────────────────────────
 * 与 7D4 同款：`dataSourceManager.use(...)` 注册的中间件会被合并进每个数据源的
 * resourceManager，所以能拿到外部数据源上的 write 动作。命中「改 owner_name」就转交连接器，
 * 由连接器在**同一事务**内完成：补 owner_id → 置 assign_status='已指派' → 留痕 → 回写负责人表。
 *
 * ── 为什么不改页面 ────────────────────────────────────────────
 * 拦截对页面完全透明：主管照旧在下拉里选人。而且前端联动规则挡不住
 * 表格内联编辑 / 批量更新 / 直接调 API 这些绕过路径，必须在服务端做。
 *
 * ── 与 7D4 拦截的差别 ─────────────────────────────────────────
 * 7D4 是「子订单粒度、按平台订单扩散」，每日表本来就是「一个主体一行」，
 * 所以这里按行指派即可，不需要按订单号展开。
 */
import type { Application } from '@nocobase/server';
import { connectorClient } from './services/connector-client';
import { isAssigner } from './after-sales-roles';

/** 外部数据源 key（power_automate = 本地/生产的 MySQL） */
const DATA_SOURCE_KEY = process.env.AFTER_SALES_DAILY_DATA_SOURCE || 'd_99cwsyi7q4k';
/** 每日售后订单表 */
const COLLECTION = process.env.AFTER_SALES_DAILY_COLLECTION || 'DailyAfterSalesOrder';

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

/** 从动作参数里取出要改哪几行：单行改走 filterByTk，批量改走 filter.id.$in */
function normalizeTargets(params: any) {
  const { filterByTk, filter } = params || {};
  const rowIds: number[] = [];
  const identityKeys: string[] = [];

  const pushId = (v: unknown) => {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) rowIds.push(n);
  };
  const pushKey = (v: unknown) => {
    const t = String(v ?? '').trim();
    if (t) identityKeys.push(t);
  };

  if (Array.isArray(filterByTk)) filterByTk.forEach(pushId);
  else if (filterByTk !== undefined && filterByTk !== null) pushId(filterByTk);

  if (filter && typeof filter === 'object') {
    const idFilter = (filter as any).id;
    if (typeof idFilter === 'string' || typeof idFilter === 'number') pushId(idFilter);
    else if (Array.isArray(idFilter)) idFilter.forEach(pushId);
    else if (idFilter && typeof idFilter === 'object' && Array.isArray((idFilter as any).$in)) {
      (idFilter as any).$in.forEach(pushId);
    }
    const keyFilter = (filter as any).identity_key;
    if (typeof keyFilter === 'string') pushKey(keyFilter);
    else if (Array.isArray(keyFilter)) keyFilter.forEach(pushKey);
    else if (keyFilter && typeof keyFilter === 'object' && Array.isArray((keyFilter as any).$in)) {
      (keyFilter as any).$in.forEach(pushKey);
    }
  }

  return { rowIds: [...new Set(rowIds)], identityKeys: [...new Set(identityKeys)] };
}

/** 把页面上的姓名解析成 NocoBase 用户（负责人下拉的 value 就是姓名/昵称） */
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
 * 必须在 `load()` 里调用 —— 要早于数据源首次被使用，
 * 因为数据源只在第一次 `middleware()` 时合并 dataSourceManager 的中间件。
 */
export function installDailyAfterSalesAssign(app: Application, logger?: Logger): boolean {
  const manager = app.dataSourceManager as any;
  if (!manager?.use) {
    logger?.warn?.('[daily-assign] dataSourceManager 不可用，跳过安装');
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
    const ownerName = String(values.owner_name ?? '').trim();
    // 没动「售后负责人」的写入照常走原生（改处理状态 / 写备注等不受影响）
    if (!ownerName) {
      return next();
    }

    // ★ 本中间件命中后不调 next()，等于绕过了原生 CRUD 上的 ACL 行级 scope，
    //   所以必须自己判"这个人有没有资格改派"（§7.4：只有主管可以）。
    //   实测漏了这一步时，售后负责人提交 owner_name 就能把单子推给同事。
    if (!(await isAssigner(ctx))) {
      ctx.throw(403, '只有售后主管可以指派/改派负责人');
      return;
    }

    const owner = await resolveUser(app, ownerName);
    if (!owner) {
      ctx.throw(400, `负责人「${ownerName}」在 NocoBase 用户里找不到（请检查昵称是否与下拉选项一致）`);
      return;
    }

    const targets = normalizeTargets(meta.params);
    if (!targets.rowIds.length && !targets.identityKeys.length) {
      ctx.throw(400, '无法确定要指派哪一行（缺少 filterByTk / filter）');
      return;
    }

    const operator = ctx.state?.currentUser
      ? {
          id: Number(ctx.state.currentUser.id),
          name: ctx.state.currentUser.nickname || ctx.state.currentUser.username,
        }
      : undefined;

    try {
      const result = await connectorClient.assignDailyAfterSalesOrder({
        rowIds: targets.rowIds,
        identityKeys: targets.identityKeys,
        owner,
        operator,
        source: 'manual',
      });
      logger?.info?.(`[daily-assign] ${result.updated} 行 → ${owner.name}`);
      // 拦截成功：不回 next()，避免原生 update 把 owner_name 再写一遍
      ctx.body = {
        data: {
          ...result,
          owner_id: owner.id,
          owner_name: owner.name,
          assign_status: '已指派',
        },
      };
    } catch (error: any) {
      logger?.error?.(`[daily-assign] 失败: ${error?.message}`);
      ctx.throw(502, `指派失败：${error?.message || '连接器不可用'}`);
    }
  });

  logger?.info?.(`[daily-assign] 已安装拦截：${DATA_SOURCE_KEY}.${COLLECTION}`);
  return true;
}

export { COLLECTION as DAILY_AFTER_SALES_COLLECTION, DATA_SOURCE_KEY as DAILY_AFTER_SALES_DATA_SOURCE };
