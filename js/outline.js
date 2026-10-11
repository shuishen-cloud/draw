import { DBG, escapeHtml, state, view } from './state.js';
import { selectNode } from './nodes.js';
import { applyView, canvasEl, fitToContent } from './viewport.js';
import { nodesInZone } from './zones.js';

// -------- 层级过滤：只显示某个区域（或全部）--------
export function applyFilter() {
  const f = state.filterZoneId;
  const showAll = f === 'all';

  // 节点：属于当前区域的显示，其他淡出
  for (const n of Object.values(state.nodes)) {
    const visible = showAll || n.zoneId === f;
    n.el.classList.toggle('dim', !visible);
  }
  // 区域：非当前区域淡出
  for (const z of Object.values(state.zones)) {
    const visible = showAll || z.id === f;
    z.el.classList.toggle('dim', !visible);
  }
  // 连线：两端都可见才显示，否则淡出
  for (const e of Object.values(state.edges)) {
    const a = state.nodes[e.source], b = state.nodes[e.target];
    const visible = showAll
      || ((a && a.zoneId === f) && (b && b.zoneId === f));
    if (e.pathEl) e.pathEl.classList.toggle('dim', !visible);
    if (e.labelEl) e.labelEl.classList.toggle('dim', !visible);
  }
  refreshLevelFilter();
  DBG.log('层级过滤 ->', showAll ? '全部' : (state.zones[f]?.title || f));
}

// -------- 大纲栏 --------
export function refreshOutline() {
  const body = document.getElementById('outlineBody');
  if (!body) return;
  const zones = Object.values(state.zones);
  const html = [];

  for (const z of zones) {
    const items = nodesInZone(z.id);
    html.push(`<div class="ol-zone">`);
    html.push(`<div class="ol-zone-head" data-zone="${z.id}">`);
    html.push(`<span class="zcolor" style="background:${z.color}"></span>`);
    html.push(`<span class="ztitle">${escapeHtml(z.title)}</span>`);
    html.push(`<span class="zcount">${items.length}</span>`);
    html.push(`</div>`);
    html.push(`<div class="ol-items">`);
    if (!items.length) html.push(`<div class="ol-empty">（无节点）</div>`);
    for (const n of items) html.push(outlineItem(n));
    html.push(`</div></div>`);
  }

  // 未分类节点
  const loose = Object.values(state.nodes).filter(n => !n.zoneId);
  html.push(`<div class="ol-zone">`);
  html.push(`<div class="ol-zone-head" data-zone="">`);
  html.push(`<span class="zcolor" style="background:#c3c6cb"></span>`);
  html.push(`<span class="ztitle">未分类</span>`);
  html.push(`<span class="zcount">${loose.length}</span>`);
  html.push(`</div><div class="ol-items">`);
  if (!loose.length) html.push(`<div class="ol-empty">（无）</div>`);
  for (const n of loose) html.push(outlineItem(n));
  html.push(`</div></div>`);

  body.innerHTML = html.join('');

  // 点击区域标题 -> 聚焦该区域
  body.querySelectorAll('.ol-zone-head').forEach(h => {
    h.addEventListener('click', () => {
      const zid = h.dataset.zone;
      if (zid && state.zones[zid]) focusZone(zid);
      else fitToContent();
    });
  });
  // 点击节点 -> 选中并聚焦
  body.querySelectorAll('.ol-item').forEach(it => {
    it.addEventListener('click', () => {
      const nid = it.dataset.node;
      if (state.nodes[nid]) focusNode(nid);
    });
  });
}

const KIND_ICON = { doc: '📄', output: '🎯', img: '🖼️', exec: '⚙️' };
export function outlineItem(n) {
  const label = (n.kind === 'img'
    ? (n.src ? '图片' : '空图片')
    : n.kind === 'exec'
      ? (n.prompt ? n.prompt.slice(0, 20) : '执行节点')
      : ((n.text || '').trim().slice(0, 20) || '（空）'));
  return `<div class="ol-item" data-node="${n.id}">
    <span class="ikind">${KIND_ICON[n.kind] || '⬜'}</span>
    <span class="iname">${escapeHtml(label)}</span>
  </div>`;
}

// -------- 层级过滤器 UI --------
export function refreshLevelFilter() {
  const bar = document.getElementById('levelFilter');
  if (!bar) return;
  const zones = Object.values(state.zones);
  const btns = [`<span class="lvl-btn ${state.filterZoneId === 'all' ? 'active' : ''}" data-f="all">全部</span>`];
  for (const z of zones) {
    btns.push(`<span class="lvl-btn ${state.filterZoneId === z.id ? 'active' : ''}" data-f="${z.id}">${escapeHtml(z.title)}</span>`);
  }
  bar.innerHTML = btns.join('');
  bar.querySelectorAll('.lvl-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.filterZoneId = b.dataset.f;
      applyFilter();
    });
  });
}

// 聚焦到某个区域（居中显示）
export function focusZone(zid) {
  const z = state.zones[zid];
  if (!z) return;
  const r = canvasEl().getBoundingClientRect();
  const pad = 40;
  const sx = (r.width - pad * 2) / z.w, sy = (r.height - pad * 2) / z.h;
  view.scale = Math.min(2, Math.max(0.15, Math.min(sx, sy)));
  view.x = (r.width - z.w * view.scale) / 2 - z.x * view.scale;
  view.y = (r.height - z.h * view.scale) / 2 - z.y * view.scale;
  applyView();
}

// 聚焦到某个节点
export function focusNode(nid) {
  const n = state.nodes[nid];
  if (!n) return;
  selectNode(nid);
  const r = canvasEl().getBoundingClientRect();
  view.x = r.width / 2 - (n.x + n.w / 2) * view.scale;
  view.y = r.height / 2 - (n.y + n.h / 2) * view.scale;
  applyView();
}

// =========================================================================
