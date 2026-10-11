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
export function fitToContent(padding = 60) {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) { view.x = 0; view.y = 0; view.scale = 1; applyView(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  const r = canvasEl().getBoundingClientRect();
  const cw = maxX - minX, ch = maxY - minY;
  const sx = (r.width  - padding * 2) / cw;
  const sy = (r.height - padding * 2) / ch;
  view.scale = Math.min(2, Math.max(0.15, Math.min(sx, sy)));
  view.x = (r.width  - cw * view.scale) / 2 - minX * view.scale;
  view.y = (r.height - ch * view.scale) / 2 - minY * view.scale;
  applyView();
}

// =========================================================================
