// =========================================================================
// edgeops.js —— 连线操作的纯逻辑（无 DOM，可在 Node 里单测）
//
// 为什么单独成模块：试测（tests/e2e_*.cjs）需要浏览器，而本机环境不一定有。
// 把「插入节点的坐标/命令归属/区域继承」这类**纯计算**抽出来，
// 就能用 node --test 直接覆盖，DOM 层只负责调用与重绘。
// =========================================================================

/**
 * 计算在连线中间插入节点后的布局与命令归属。
 *
 * @param {object} src   上游节点 { id, x, y, w, h, zoneId }
 * @param {object} dst   下游节点 { id, x, y, w, h, zoneId }
 * @param {object} edge  原连线 { id, command }
 * @param {object} [opts]
 * @param {number} [opts.width=300]   新节点宽
 * @param {number} [opts.height=160]  新节点高
 * @returns {{
 *   x:number, y:number, w:number, h:number, zoneId:string|null,
 *   upstreamCommand:string, downstreamCommand:string, valid:boolean
 * }}
 */
export function planInsertOnEdge(src, dst, edge, opts = {}) {
  const w = opts.width ?? 300;
  const h = opts.height ?? 160;
  const valid = !!(src && dst);
  if (!valid) {
    return {
      x: 0, y: 0, w, h, zoneId: null,
      upstreamCommand: '', downstreamCommand: '', valid: false,
    };
  }

  // 两节点几何中心的中点，再把新节点自身居中到该点
  const midX = ((src.x + src.w / 2) + (dst.x + dst.w / 2)) / 2;
  const midY = ((src.y + src.h / 2) + (dst.y + dst.h / 2)) / 2;

  return {
    x: Math.round(midX - w / 2),
    y: Math.round(midY - h / 2),
    w, h,
    // 继承上游区域：否则插完会掉到大纲外面（用户心智里它属于同一组）
    zoneId: src.zoneId ?? null,
    // 命令留在上游：原命令描述「对 src 的输出做什么」，语义上属于产生新节点的那一段。
    // 这样 Alt+Enter 从 src 出发仍然执行原来的命令。
    upstreamCommand: edge?.command ?? '',
    downstreamCommand: '',
    valid: true,
  };
}

/**
 * 判断一条连线的删除是否应该被允许（纯判定，便于测试边界）。
 * 目前只拒绝「不存在的 id」。
 */
export function canRemoveEdge(edges, edgeId) {
  return !!(edges && edgeId && edges[edgeId]);
}
