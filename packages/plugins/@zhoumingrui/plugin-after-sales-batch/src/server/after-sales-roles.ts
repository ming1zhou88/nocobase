/**
 * 售后角色判定（三个中间件共用）
 *
 * ── 为什么单独抽出来 ──────────────────────────────────────────
 * 「谁能改派负责人」这件事在两个**指派拦截中间件**里都要判：
 *   · daily-after-sales-assign.ts（每日表）
 *   · tracking-exception-assign.ts（7D4）
 * 而且这两个中间件有个共同特点：**命中后直接短路、不调 next()**，
 * 也就是绕过了原生 CRUD（以及挂在原生 CRUD 上的 ACL 行级 scope）。
 * 所以它们**必须自己判权限**，否则任何能调 update 的用户都能借它改派任何人。
 *
 * 实测（2026-10-13）：售后负责人提交 `{owner_id:8, owner_name:'厉涵静'}`，
 * 请求被指派中间件接走并转交连接器执行成功 —— 等于专员可以把单子推给同事。
 * 这不是配置问题，是中间件缺了自己的授权判断，只能在这里补。
 */
import type { Context } from '@nocobase/actions';

/** 有资格改派负责人的角色 */
export const ASSIGNER_ROLES = ['after_sales_manager', 'admin', 'root'];

/** 取当前用户的角色名（沿用 ACL 插件自己的取法：users.roles 关联仓库） */
export async function currentRoleNames(ctx: Context | any): Promise<string[]> {
  const user = ctx?.state?.currentUser;
  if (!user?.id) return [];
  try {
    const repository = ctx.db.getRepository('users.roles', user.id);
    const roles = await repository.find({ raw: true });
    return roles.map((r: any) => String(r?.get ? r.get('name') : r?.name)).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 当前请求是否有资格改派负责人。
 *
 * ⚠️ 没有登录用户的上下文（内部任务 / 系统调用）返回 `true`：
 *    那种请求本来就不带用户身份，权限由 ACL 与调用方自己把关；
 *    在这里判 false 会把自动化任务一起挡掉。
 */
export async function isAssigner(ctx: Context | any): Promise<boolean> {
  if (!ctx?.state?.currentUser?.id) return true;
  const roles = await currentRoleNames(ctx);
  return roles.some((r) => ASSIGNER_ROLES.includes(r));
}
