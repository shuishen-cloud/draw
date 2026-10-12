import { state, view } from './state.js';
import { applyView, canvasEl, screenToWorld } from './viewport.js';
// 11.5 小地图（全局总览）
// =========================================================================
export function contentBounds() {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  return { minX, minY, maxX, maxY };
}

// 小地图坐标换算（在 contentBounds 基础上加 padding）
export function miniTransform() {
  const b = contentBounds();
  const pad = 80;
  const x0 = b.minX - pad, y0 = b.minY - pad;
  const w  = (b.maxX - b.minX) + pad * 2;
  const h  = (b.maxY - b.minY) + pad * 2;
  const cv = document.querySelector('#minimap canvas');
  const cw = cv.clientWidth, ch = cv.clientHeight;
  const s = Math.min(cw / w, ch / h);
  const ox = (cw - w * s) / 2, oy = (ch - h * s) / 2;
  return { x0, y0, s, ox, oy };
}

export function drawMiniMap() {
  const map = document.getElementById('minimap');
  if (map.classList.contains('hidden')) return;
  const cv = map.querySelector('canvas');
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.clientWidth, ch = cv.clientHeight;
  if (cv.width !== cw * dpr) { cv.width = cw * dpr; cv.height = ch * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const { x0, y0, s, ox, oy } = miniTransform();
  const W = (wx) => (wx - x0) * s + ox;
  const H = (wy) => (wy - y0) * s + oy;

  // 连线
  ctx.strokeStyle = '#c7cad0'; ctx.lineWidth = 1;
  for (const e of Object.values(state.edges)) {
    const a = state.nodes[e.source], b = state.nodes[e.target];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(W(a.x + a.w), H(a.y + a.h / 2));
    ctx.lineTo(W(b.x), H(b.y + b.h / 2));
    ctx.stroke();
  }

  // 节点
  const colors = { doc: '#16a34a', output: '#eab308', img: '#0ea5e9' };
  for (const n of Object.values(state.nodes)) {
    ctx.fillStyle = (colors[n.kind] || '#999') + '33';
    ctx.strokeStyle = colors[n.kind] || '#999';
    ctx.lineWidth = 1.5;
    const rx = W(n.x), ry = H(n.y), rw = n.w * s, rh = n.h * s;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, 2); else ctx.rect(rx, ry, rw, rh);
    ctx.fill(); ctx.stroke();
  }

  // 当前视口矩形
  const r = canvasEl().getBoundingClientRect();
  const tl = screenToWorld(r.left, r.top);
  const vx = W(tl.x), vy = H(tl.y), vw = (r.width / view.scale) * s, vh = (r.height / view.scale) * s;
  ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(79,70,229,.08)';
  ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.fill(); ctx.stroke();
}

// 点击小地图跳转视口
export function bindMiniMapClick() {
  const map = document.getElementById('minimap');
  map.addEventListener('pointerdown', (e) => {
    const cv = map.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const { x0, y0, s, ox, oy } = miniTransform();
    const wx = (px - ox) / s + x0;
    const wy = (py - oy) / s + y0;
    const cr = canvasEl().getBoundingClientRect();
    view.x = cr.width  / 2 - wx * view.scale;
    view.y = cr.height / 2 - wy * view.scale;
    applyView();
  });
}

// =========================================================================
