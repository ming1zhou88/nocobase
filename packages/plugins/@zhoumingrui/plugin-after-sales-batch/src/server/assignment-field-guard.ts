/**
 * 「指派类字段」的写权限守卫
 *
 * ── 为什么必须自己做 ──────────────────────────────────────────
 * 需求 §7.4 的角色动作矩阵：**「指派/改派负责人」只有主管能做**，售后负责人 ❌。
 * 但 ACL 的**行级** scope 只限制"能改哪几行"，不限制"能改哪几列"：
 * 专员的行级 scope 是 `owner_id = 自己`，于是他可以把自己那行的 `owner_id`
 * 改成别人 —— 等于把单子推给同事（或清空，让所有人都看不见，只有主管能看到）。
 * 实测（2026-10-13）确实能改成功。
 *
 * ── 为什么不用 ACL 的 fields ──────────────────────────────────
 * 试过，不生效：`plugin-acl/src/server/middlewares/` 里没有任何处理 `fields` 的代码，
 * `roles:check` 里 `update` 动作的 `fields` 始终是 `undefined`，配了行为也不变。
 * `fields` 只影响**客户端渲染哪些列**（这正是坑 2：为空会让该表所有列消失）。
 *
 * ── 策略：拒绝，而不是静默丢弃 ────────────────────────────────
 * 页面上的内联编辑如果被静默忽略（HTTP 200 但没改），是最难排查的一类问题；
 * 所以这里直接 403 并说明原因，用户当场就能看到"这事得找主管"。
 *
 * ── 放行规则 ──────────────────────────────────────────────────
 *   · 主管 / admin / root：放行（主管的 `owner_name`/`handler_name` 编辑会在
 *     指派中间件里被接走，不会真的走原生写）
 *   · 没有登录用户的上下文（内部任务/系统调用）：放行 —— 用户请求已经由 ACL 把关
 *   · 其余（售后负责人等）：只要写入体里出现指派类字段就 403
 */
import type { Application } from '@nocobase/server';

const DATA_SOURCE_KEY = process.env.AFTER_SALES_DAILY_DATA_SOURCE || 'd_99cwsyi7q4k';

/** 各表的「指派类字段」：改了它们就等于改派负责人 */
const GUARDED_FIELDS: Record<string, string[]> = {
  DailyAfterSalesOrder: ['owner_id', 'owner_name', 'assign_status', 'assign_source', 'assigned_by', 'assigned_at'],
  TrackingException7D4Full: [
    'handler_id',
    'handler_name',
    'owner_account',
    'owner_name',
    'assign_source',
    'assigned_by',
    'assigned_at',
  ],
};

/** 有资格改派负责人的角色 */
const ASSIGNER_ROLES = ['after_sales_manager', 'admin', 'root'];

const WRITE_ACTIONS = new Set(['update', 'updateMany', 'updateOrCreate', 'firstOrCreate', 'create', 'createMany']);

type Logger = { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };

/** 取当前用户的角色名（与两个指派中间件共用同一份实现） */
async function currentRoleNames(ctx: any): Promise<string[]> {
  const user = ctx.state?.currentUser;
  if (!user?.id) return [];
  try {
    const repository = ctx.db.getRepository('users.roles', user.id);
    const roles = await repository.find({ raw: true });
    return roles.map((r: any) => String(r.get ? r.get('name') : r.name)).filter(Boolean);
  } catch {
    return [];
  }
}

export function installAssignmentFieldGuard(app: Application, logger?: Logger): boolean {
  const manager = app.dataSourceManager as any;
  if (!manager?.use) {
    logger?.warn?.('[assign-guard] dataSourceManager 不可用，跳过安装');
    return false;
  }

  manager.use(async (ctx: any, next: () => Promise<void>) => {
    const action = ctx?.action || {};
    const params = action.params || {};
    const dataSourceKey = ctx?.get?.('x-data-source') || 'main';
    const resourceName = action.resourceName || params.resourceName;
    const actionName = action.actionName || params.actionName;

    const guarded = GUARDED_FIELDS[resourceName];
    if (dataSourceKey !== DATA_SOURCE_KEY || !guarded || !WRITE_ACTIONS.has(String(actionName))) {
      return next();
    }

    const values = params?.values || {};
    const touched = guarded.filter((f) => values[f] !== undefined);
    if (!touched.length) {
      return next();
    }

    // 无登录用户 → 内部/系统上下文，交给 ACL 把关
    if (!ctx.state?.currentUser?.id) {
      return next();
    }

    const roles = await currentRoleNames(ctx);
    if (roles.some((r) => ASSIGNER_ROLES.includes(r))) {
      return next();
    }

    logger?.warn?.(
      `[assign-guard] 拦截越权改派：user=${ctx.state.currentUser.id}` +
        ` resource=${resourceName} fields=${touched.join(',')}`,
    );
    ctx.throw(403, `只有售后主管可以指派/改派负责人（本次提交包含：${touched.join('、')}）`);
  });

  logger?.info?.(`[assign-guard] 已安装：指派类字段写守卫（${Object.keys(GUARDED_FIELDS).join(' / ')}）`);
  return true;
}

export { GUARDED_FIELDS, ASSIGNER_ROLES };
