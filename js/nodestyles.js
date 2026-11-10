// =========================================================================
// nodestyles.js —— 卡片配色的纯数据层（无 DOM，可 Node 单测）
//
// 为什么单独成模块：颜色 key 的合法性与回退规则要被导入/导出/渲染三处共用，
// 抽成纯函数后既能保证一致，也能在没有浏览器的环境里直接测。
// =========================================================================

/** 调色板 key，顺序即调色板里的展示顺序 */
export const NODE_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

/**
 * 规整一个颜色值。
 * - 合法 key → 原样返回
 * - null / undefined / '' → null（表示「跟随 kind 默认色」）
 * - 其它（拼错、旧数据、数字等）→ null
 *
 * 关键点：**非法值绝不能抛错**，否则旧画布文件会整体导入失败。
 */
export function normalizeColor(color) {
  if (typeof color !== 'string') return null;
  const v = color.trim().toLowerCase();
  return NODE_COLORS.includes(v) ? v : null;
}

/** 是否设置了自定义颜色（供 UI 判断要不要显示「清除」项） */
export function hasCustomColor(color) {
  return normalizeColor(color) !== null;
}

/** 下一个颜色（调色板循环）——给「点一下换个色」的快捷操作留接口 */
export function nextColor(color) {
  const cur = normalizeColor(color);
  if (cur === null) return NODE_COLORS[0];
  const i = NODE_COLORS.indexOf(cur);
  return NODE_COLORS[(i + 1) % NODE_COLORS.length];
}
