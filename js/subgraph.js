// =========================================================================
// subgraph.js —— 子图（框选收藏）的纯逻辑
//
// 两个关键点（见 doc/feat/favorite-subgraph.md）：
//   1. 闭包裁剪：只保留「两端都在选区内」的边。否则导入后悬空边会被
//      importCanvasData 静默丢弃，用户看到「收藏时有线，导入后没了」。
//   2. id 重映射：导入时一律换新 id。收藏是过去的快照，画布上可能已存在
//      同 id 节点；复用会导致状态表键冲突与连线指向错误。
//      注意：这里**不做** remap —— 新 id 必须来自 createNode 的实际分配，
//      预先用工厂「猜」id 会和 createNode 内部的 ++seq 脱节，导致边指向
//      不存在的新节点（表现为「导入后连线消失」）。真实映射表在
//      favorites.js::restoreSubgraph 里边建边记。
// =========================================================================
import { DBG } from './state.js';

const rectOf = (n) => ({ x: n.x, y: n.y, w: n.w || 0, h: n.h || 0 });

// 两个矩形是否相交（含接触）
function intersects(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x ||
           a.y + a.h < b.y || b.y + b.h < a.y);
}

// 由节点集合计算包围盒
export function boundsOf(nodes) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const r = rectOf(n);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 框选子图。
 * @param {{x:number,y:number,w:number,h:number}} rect 选区（world 坐标）
 * @param {Array} nodes 画布节点
 * @param {Array} edges 画布连线
 * @returns {{nodes:Array, edges:Array, bounds:object}}
 */
export function pickSubgraph(rect, nodes, edges) {
  const picked = nodes.filter(n => intersects(rectOf(n), rect));
  const ids = new Set(picked.map(n => n.id));

  // 闭包：两端都在选区内才保留
  const keptEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target));

  const dropped = edges.length - keptEdges.length;
  if (dropped > 0) {
    DBG.log('框选裁剪：丢弃', dropped, '条跨框连线');
  }

  return {
    nodes: picked.map(n => ({
      id: n.id, kind: n.kind, title: n.title,
      x: n.x, y: n.y, w: n.w, h: n.h,
      text: n.text || '', prompt: n.prompt || '',
      zoneId: n.zoneId || null, level: n.level || 1,
      src: n.src || '',
    })),
    edges: keptEdges.map(e => ({
      id: e.id, source: e.source, target: e.target, command: e.command || '',
    })),
    bounds: boundsOf(picked),
  };
}

// 把子图整体平移到以 pos 为中心，返回偏移量
export function centerOffset(bounds, pos) {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const px = Number.isFinite(pos?.x) ? pos.x : 0;
  const py = Number.isFinite(pos?.y) ? pos.y : 0;
  return { dx: px - cx, dy: py - cy };
}
