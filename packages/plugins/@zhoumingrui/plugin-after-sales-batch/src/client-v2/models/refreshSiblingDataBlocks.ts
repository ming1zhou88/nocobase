/**
 * 刷新同一容器内的兄弟数据块。
 *
 * 背景：每日售后订单页面是「图表块 + 数据表块」并列。
 * 指派 action 只刷新了自己的数据表 block，图表块是独立 resource，
 * 不会收到通知，导致「工作量 / 今日分配量 / 每人」要整页刷新才更新。
 *
 * 这里从当前 block 向上找到第一个有兄弟模型的容器（通常是 grid），
 * 对兄弟模型调用 refresh()（ChartBlockModel 已实现该方法）。
 * 失败不影响主流程，避免刷新异常把“指派成功”误报成失败。
 */
export async function refreshSiblingDataBlocks(blockModel: any): Promise<void> {
  if (!blockModel) return;

  const seen = new Set<any>();
  let parent = blockModel.parent;

  for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parent) {
    const groups = parent.subModels || {};
    let found = false;

    for (const value of Object.values(groups)) {
      const models = Array.isArray(value) ? value : [value];
      for (const model of models) {
        if (!model || model === blockModel || seen.has(model)) continue;
        seen.add(model);
        found = true;

        try {
          if (typeof model.refresh === 'function') {
            await model.refresh();
          } else if (typeof model.resource?.refresh === 'function') {
            await model.resource.refresh();
          }
        } catch {
          // 单个块刷新失败不影响指派结果
        }
      }
    }

    // 最近一层有兄弟块就结束，避免重复刷新整页所有块
    if (found) return;
  }
}
