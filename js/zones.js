import { DBG, ZONE_COLORS, seq, state, view } from './state.js';
import { redrawEdges } from './edges.js';
import { layoutNode, refreshAllZonePickers } from './nodes.js';
import { applyFilter, refreshOutline } from './outline.js';
import { worldEl } from './viewport.js';
// 1.8 区域（Zone）—— 大纲的层级单位
// =========================================================================
export function createZone(opts = {}) {
  const id = 'z' + (++seq.zone);
  const color = opts.color || ZONE_COLORS[(seq.zone - 1) % ZONE_COLORS.length];
  const zone = {
    id,
    title: opts.title || ('区域 ' + seq.zone),
    x: opts.x ?? 60 + (seq.zone % 4) * 30,
    y: opts.y ?? 60 + (seq.zone % 4) * 30,
    w: opts.w ?? 420,
    h: opts.h ?? 300,
    color,
    level: opts.level ?? 1,
    el: null,
  };
  state.zones[id] = zone;
  renderZone(zone);
  layoutZone(zone);
  if (!window.__silentImport) {
    refreshAllZonePickers();    // 新区域要出现在所有节点的下拉里
    refreshOutline();
    window.scheduleSnapshot?.();
  }
  DBG.log('创建区域', id, zone.title);
  return zone;
}

export function removeZone(id) {
  const z = state.zones[id];
  if (!z) return;
  // 区域内节点解除归属（不删节点）
  Object.values(state.nodes).forEach(n => { if (n.zoneId === id) n.zoneId = null; });
  if (state.filterZoneId === id) state.filterZoneId = 'all';
  z.el.remove();
  delete state.zones[id];
  refreshAllZonePickers();    // 从下拉里移除该区域
  refreshOutline();
  applyFilter();
  DBG.log('删除区域', id);
}

export function renderZone(zone) {
  const el = document.createElement('div');
  el.className = 'zone';
  el.id = 'zone-' + zone.id;
  el.innerHTML = `
    <div class="zone-bar">
      <span class="zone-title"></span>
      <span class="zone-close" title="删除区域">×</span>
    </div>
    <div class="zone-resize"></div>
  `;
  const bar = el.querySelector('.zone-bar');
  bar.style.background = zone.color;

  // 拖动区域
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('zone-close')) return;
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = zone.x, oy = zone.y;
    const zoneNodes = nodesInZone(zone.id);
    // 用累积位移避免重复叠加
    let lastDx = 0, lastDy = 0;
    function onMove2(ev) {
      const dx = (ev.clientX - sx) / view.scale;
      const dy = (ev.clientY - sy) / view.scale;
      zone.x = ox + dx; zone.y = oy + dy;
      layoutZone(zone);
      const stepX = dx - lastDx, stepY = dy - lastDy;
      lastDx = dx; lastDy = dy;
      for (const n of zoneNodes) { n.x += stepX; n.y += stepY; layoutNode(n); }
      redrawEdges();
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove2);
      window.removeEventListener('pointerup', onUp);
      window.scheduleSnapshot?.();   // 区域拖动结束保存
    }
    window.addEventListener('pointermove', onMove2);
    window.addEventListener('pointerup', onUp);
  });

  el.querySelector('.zone-close').addEventListener('click', (e) => {
    e.stopPropagation();
    removeZone(zone.id);
  });

  // 缩放手柄
  el.querySelector('.zone-resize').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ow = zone.w, oh = zone.h;
    function onMove(ev) {
      zone.w = Math.max(160, ow + (ev.clientX - sx) / view.scale);
      zone.h = Math.max(120, oh + (ev.clientY - sy) / view.scale);
      layoutZone(zone);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.scheduleSnapshot?.();   // 区域缩放结束保存
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // 双击标题改名
  el.querySelector('.zone-title').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const t = prompt('区域名称（大纲章节名）：', zone.title);
    if (t !== null) { zone.title = t; el.querySelector('.zone-title').textContent = t; refreshOutline(); }
  });

  // 区域节点挂到 world 的最底层（z-index 最低）
  worldEl().insertBefore(el, worldEl().firstChild);
  zone.el = el;
}

export function layoutZone(zone) {
  const el = zone.el;
  if (!el) return;
  el.style.left = zone.x + 'px';
  el.style.top = zone.y + 'px';
  el.style.width = zone.w + 'px';
  el.style.height = zone.h + 'px';
  el.style.borderColor = zone.color;
  el.style.background = zone.color + '14';
  el.querySelector('.zone-title').textContent = zone.title;
}

export function nodesInZone(zoneId) {
  return Object.values(state.nodes).filter(n => n.zoneId === zoneId);
}
