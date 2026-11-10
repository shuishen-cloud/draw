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
 * @param {'before'|'after'} [opts.position='before']
 *        新节点相对「原命令」的位置：
 *          before —— A →(空) X →(原命令) B  先处理原始信息，再交给原命令（默认）
 *          after  —— A →(原命令) X →(空) B  原命令先作用，再对新结果加工
 * @returns {{
 *   x:number, y:number, w:number, h:number, zoneId:string|null,
 *   upstreamCommand:string, downstreamCommand:string,
 *   position:'before'|'after', valid:boolean
 * }}
 */
export function planInsertOnEdge(src, dst, edge, opts = {}) {
  const w = opts.width ?? 300;
  const h = opts.height ?? 160;
  // 非法值一律按 before：宁可给默认语义，也不让插入失败
  const position = opts.position === 'after' ? 'after' : 'before';
  const valid = !!(src && dst);
  if (!valid) {
    return {
      x: 0, y: 0, w, h, zoneId: null,
      upstreamCommand: '', downstreamCommand: '', position, valid: false,
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
    // 命令归属取决于插入位置 —— 命令只会出现在其中一条线上，绝不复制/丢失：
    //   before：命令跟到下游（新节点先处理原始信息）
    //   after ：命令留在上游（先执行原命令，结果进新节点）
    upstreamCommand: position === 'after' ? (edge?.command ?? '') : '',
    downstreamCommand: position === 'after' ? '' : (edge?.command ?? ''),
    position,
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
