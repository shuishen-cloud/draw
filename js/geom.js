// =========================================================================
// geom.js —— 连线几何与命中判定的纯函数（无 DOM 依赖，便于 node 下测试）
//
// 约定：所有坐标均为 world 坐标（节点 x/y/w/h 所在的同一坐标系）。
// =========================================================================

// 两个矩形的「最近边界锚点」：线从各自朝向对方的边中点出发 / 落下。
// 这样线始终连在节点的边上，而不是固定的左右中点。
export function rectAnchor(from, to) {
  const dX = Math.max(0, Math.max(from.x - (to.x + to.w), to.x - (from.x + from.w)));
  const dY = Math.max(0, Math.max(from.y - (to.y + to.h), to.y - (from.y + from.h)));
  const fromCx = from.x + from.w / 2, fromCy = from.y + from.h / 2;
  const toCx = to.x + to.w / 2, toCy = to.y + to.h / 2;
  // 水平间隔更大 → 用左右边中点；否则用上下边中点
  if (dX >= dY) {
    const onRight = fromCx <= toCx;
    return { x: onRight ? from.x + from.w : from.x, y: fromCy };
  }
  const onBottom = fromCy <= toCy;
  return { x: fromCx, y: onBottom ? from.y + from.h : from.y };
}

// 连线两端点：源节点边上 → 目标节点边上
export function edgeEndpoints(a, b) {
  const p1 = rectAnchor(a, b);
  const p2 = rectAnchor(b, a);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

// 点到矩形的「边界距离」：在矩形内部为 0，外部为欧氏距离。
export function distanceToRect(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// 命中判定：点落在矩形及其外扩 tol 的带内（含矩形内部）。
// 多个节点重叠时：先取距离最近者；距离相同（嵌套导致都是 0）时取面积更小者
// ——即更「贴合」的那一个，符合「手指按在哪个节点的边上」的直觉。
// 返回命中的节点 id，否则 null。
export function hitTest(nodes, px, py, tol = 12) {
  let best = null, bestDist = Infinity, bestArea = Infinity;
  for (const n of nodes) {
    const d = distanceToRect(px, py, n);
    if (d > tol) continue;
    const area = n.w * n.h;
    if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) <= 1e-9 && area < bestArea)) {
      bestDist = d; bestArea = area; best = n.id;
    }
  }
  return best;
}

// 起连锚点：优先取离抓取点最近的边上位置（垂直投影到最近边），
// 保证预览线从用户按下的那一侧出发，符合直觉。
export function nearestBorderPoint(r, px, py) {
  const left = Math.abs(px - r.x), right = Math.abs(px - (r.x + r.w));
  const top = Math.abs(py - r.y), bottom = Math.abs(py - (r.y + r.h));
  const cx = Math.min(Math.max(px, r.x), r.x + r.w);
  const cy = Math.min(Math.max(py, r.y), r.y + r.h);
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: r.x, y: cy };
  if (m === right) return { x: r.x + r.w, y: cy };
  if (m === top) return { x: cx, y: r.y };
  return { x: cx, y: r.y + r.h };
}

// 三次贝塞尔路径：控制点沿锚点所在边的法线方向外推，避免线穿过节点内部。
export function edgePath(pts) {
  const { x1, y1, x2, y2, from, to } = pts;
  const k = Math.max(24, Math.min(160, Math.hypot(x2 - x1, y2 - y1) * 0.45));
  const c1 = normalOffset(from, x1, y1, x2, y2, k);
  const c2 = normalOffset(to, x2, y2, x1, y1, k);
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`;
}

// 依据锚点贴在矩形的哪条边上，决定控制点外推方向
function normalOffset(side, x, y, tx, ty, k) {
  const dir = { x: tx - x, y: ty - y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  dir.x /= len; dir.y /= len;
  switch (side) {
    case 'left':   return { x: x - k, y: y + dir.y * k * 0.5 };
    case 'right':  return { x: x + k, y: y + dir.y * k * 0.5 };
    case 'top':    return { x: x + dir.x * k * 0.5, y: y - k };
    case 'bottom': return { x: x + dir.x * k * 0.5, y: y + k };
    default:       return { x: (x + tx) / 2, y: (y + ty) / 2 };
  }
}

// 锚点贴在矩形哪条边上
export function anchorSide(r, px, py) {
  const eps = 0.5;
  if (Math.abs(px - r.x) < eps) return 'left';
  if (Math.abs(px - (r.x + r.w)) < eps) return 'right';
  if (Math.abs(py - r.y) < eps) return 'top';
  if (Math.abs(py - (r.y + r.h)) < eps) return 'bottom';
  return 'auto';
}
