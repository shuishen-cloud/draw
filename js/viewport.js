import { state, view } from './state.js';
import { drawMiniMap } from './minimap.js';

export function worldEl() { return document.getElementById('world'); }
export function canvasEl() { return document.getElementById('canvas'); }

export function applyView() {
  const w = worldEl();
  w.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  // 网格背景跟随
  const c = canvasEl();
  c.style.setProperty('--grid', (24 * view.scale) + 'px');
  c.style.setProperty('--gx', view.x + 'px');
  c.style.setProperty('--gy', view.y + 'px');
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = Math.round(view.scale * 100) + '%';
  drawMiniMap();
}

// 屏幕坐标 -> world 坐标
export function screenToWorld(sx, sy) {
  const r = canvasEl().getBoundingClientRect();
  return {
    x: (sx - r.left - view.x) / view.scale,
    y: (sy - r.top  - view.y) / view.scale,
  };
}

export function zoomAt(screenX, screenY, factor) {
  const r = canvasEl().getBoundingClientRect();
  const px = screenX - r.left, py = screenY - r.top;
  const wx = (px - view.x) / view.scale;
  const wy = (py - view.y) / view.scale;
  const next = Math.min(3, Math.max(0.15, view.scale * factor));
  view.scale = next;
  view.x = px - wx * next;
  view.y = py - wy * next;
  applyView();
}

export function panBy(dx, dy) { view.x += dx; view.y += dy; applyView(); }

// 让所有内容居中且刚好容纳
// 可见区尺寸：优先用 #canvasWrap（侧栏占位后的真实可见区域），
// 用 #canvas 会把中心算偏，导致内容跑到侧栏下面。
function visibleRect() {
  const wrap = document.getElementById('canvasWrap');
  const el = wrap || canvasEl();
  const r = el.getBoundingClientRect();
  // 与 canvasEl 的坐标差（#canvas 是绝对定位全屏层）
  const cr = canvasEl().getBoundingClientRect();
  return { left: r.left - cr.left, top: r.top - cr.top, width: r.width, height: r.height };
}

// 只居中，不改缩放
export function centerContent() {
  const nodes = Object.values(state.nodes);
  const r = visibleRect();
  if (!nodes.length) { view.x = 0; view.y = 0; applyView(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  const cw = (maxX - minX) * view.scale;
  const ch = (maxY - minY) * view.scale;
  view.x = (r.width  - cw) / 2 - minX * view.scale;
  view.y = (r.height - ch) / 2 - minY * view.scale;
  applyView();
}

export function fitToContent(padding = 60) {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) { view.x = 0; view.y = 0; view.scale = 1; applyView(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  const r = visibleRect();
  // 窄屏时减小边距，并给底部工具栏留出高度，避免内容被遮或缩得过小
  // 窄屏/平板（与 CSS 断点 1024px 对齐）：缩小边距，并给底部工具栏留高度。
  // 工具栏在 ≤1024px 时贴底横滑，约 50px 高。
  const narrow = r.width < 1024;
  const pad = narrow ? 20 : padding;
  const bottomInset = narrow ? 80 : 0;
  const usableW = Math.max(80, r.width - pad * 2);
  const usableH = Math.max(80, r.height - pad * 2 - bottomInset);
  const cw = maxX - minX, ch = maxY - minY;
  const sx = usableW / cw;
  const sy = usableH / ch;
  // 不超过 1.0：放大到 100% 以上没意义，反而丢失全局感
  view.scale = Math.min(1, Math.max(0.15, Math.min(sx, sy)));
  view.x = (r.width  - cw * view.scale) / 2 - minX * view.scale;
  view.y = (r.height - bottomInset - ch * view.scale) / 2 - minY * view.scale;
  applyView();
}

// =========================================================================
