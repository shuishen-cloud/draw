// =========================================================================
// favorites.js —— 收藏（节点）
//
// 设计要点（见 doc/feat/favorites-node.md）：
//   - 元数据与图片分表：items 里只存 srcKey，图片放 blobs（Blob）
//   - 查阅优先：preview 只读渲染，不碰画布
//   - 导入其次：restoreNode 在指定 world 坐标生成新节点
//   - 降级到 localStorage 时，图片以 dataURL 内联进 data.src
// =========================================================================
import { DBG, HOST, escapeHtml, state, view } from './state.js';
import { createNode, refreshAllZonePickers, selectNode } from './nodes.js';
import { redrawEdges } from './edges.js';
import { renderMarkdown } from './md.js';
import {
  STORE_BLOBS, STORE_ITEMS, blobToDataURL, dataURLToBlob, openStore, storeBackendName,
} from './store.js';
import { refreshOutline } from './outline.js';

let favSeq = 0;

function newFavId() {
  // 时间戳 + 序号：同一毫秒内多次收藏也不冲突
  return 'f' + Date.now().toString(36) + '-' + (++favSeq).toString(36);
}

// 收藏一个节点；返回收藏 id（失败返回 null）
export async function favoriteNode(nodeId, name) {
  const node = state.nodes[nodeId];
  if (!node) { DBG.warn('收藏失败：节点不存在', nodeId); return null; }

  const store = await openStore();
  const id = newFavId();
  const hasImage = node.kind === 'img' && !!node.src;

  const data = {
    title: node.title,
    kind: node.kind,
    text: node.text || '',
    prompt: node.prompt || '',
    w: node.w, h: node.h,
  };

  // 图片：idb 后端存 Blob 到 blobs 表；local 后端内联 dataURL
  if (hasImage) {
    if (store.backend === 'idb') {
      const blob = dataURLToBlob(node.src);
      if (blob) {
        const key = 'fb-' + id;
        await store.put(STORE_BLOBS, { key, blob, type: blob.type || 'image/png' });
        data.srcKey = key;
      } else {
        data.src = node.src;          // 解析失败就退回内联
      }
    } else {
      data.src = node.src;
    }
  }

  const item = {
    id,
    kind: 'node',
    name: (name || '').trim() || node.title || '未命名节点',
    createdAt: new Date().toISOString(),
    meta: {
      nodeKind: node.kind,
      hasImage,
      chars: (node.text || '').length + (node.prompt || '').length,
    },
    data,
  };

  try {
    await store.put(STORE_ITEMS, item);
  } catch (e) {
    DBG.err('收藏写入失败：', e);
    throw e;                            // 交给 UI 明确提示（如超限）
  }
  DBG.log('已收藏节点', nodeId, '->', id, store.backend);
  return id;
}

// 收藏列表：按创建时间倒序（新的在前）
export async function listFavoriteNodes() {
  const store = await openStore();
  const all = await store.getAll(STORE_ITEMS);
  return all
    .filter(x => x && x.kind === 'node')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// 取单条，并解析图片（有图时返回 blobUrl，供 <img> 直接用）
export async function getFavorite(id) {
  const store = await openStore();
  const item = await store.get(STORE_ITEMS, id);
  if (!item) return null;

  let imageUrl = null;
  if (item.data?.srcKey) {
    const rec = await store.get(STORE_BLOBS, item.data.srcKey);
    if (rec?.blob) imageUrl = URL.createObjectURL(rec.blob);
    else DBG.warn('收藏的图片缺失，预览将不显示图片', id);
  } else if (item.data?.src) {
    imageUrl = item.data.src;
  }
  return { item, imageUrl };
}

export async function removeFavorite(id) {
  const store = await openStore();
  const item = await store.get(STORE_ITEMS, id);
  if (!item) return false;
  const key = item.data?.srcKey;
  await store.delete(STORE_ITEMS, id);
  if (key) await store.delete(STORE_BLOBS, key);
  DBG.log('已删除收藏', id);
  return true;
}

// 把收藏还原成画布上的新节点。pos 是 world 坐标（节点中心）。
export async function restoreNode(id, pos = {}) {
  const found = await getFavorite(id);
  if (!found) { DBG.warn('导入失败：收藏不存在', id); return null; }
  const { item, imageUrl } = found;
  const d = item.data || {};

  let src = imageUrl || '';
  if (d.kind === 'img' && !src) {
    DBG.warn('收藏的图片缺失，导入为空白图片节点', id);
  }

  const w = Math.max(80, Number(d.w) || 300);
  const h = Math.max(60, Number(d.h) || 160);
  const cx = Number.isFinite(pos.x) ? pos.x : 0;
  const cy = Number.isFinite(pos.y) ? pos.y : 0;

  const node = createNode(d.kind || 'doc', {
    title: d.title,
    text: d.text,
    prompt: d.prompt,
    src,
    w, h,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
  });

  selectNode(node.id);
  refreshAllZonePickers();
  refreshOutline();
  redrawEdges();
  HOST.scheduleSnapshot?.();
  DBG.log('已从收藏导入节点', id, '->', node.id);
  return node.id;
}

// =========================================================================
// 侧栏收藏面板
// =========================================================================
let currentId = null;          // 当前预览的收藏 id
let currentBlobUrl = null;     // 需要释放的 objURL

function el(id) { return document.getElementById(id); }

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const KIND_LABEL = { doc: '文档', output: '输出', img: '图片', exec: '执行' };

export async function openFavoritesPanel() {
  const panel = el('favPanel');
  if (panel) panel.hidden = false;
  await refreshFavoritesPanel();
}

export function closeFavoritesPanel() {
  const panel = el('favPanel');
  if (panel) panel.hidden = true;
  releaseBlobUrl();
}

function releaseBlobUrl() {
  if (currentBlobUrl && currentBlobUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(currentBlobUrl); } catch { /* 忽略 */ }
  }
  currentBlobUrl = null;
}

export async function refreshFavoritesPanel() {
  const list = el('favList');
  if (!list) return;
  let items = [];
  try {
    items = await listFavoriteNodes();
  } catch (e) {
    DBG.err('读取收藏失败：', e);
    list.innerHTML = '<div class="fav-empty">读取收藏失败：' + escapeHtml(e.message) + '</div>';
    return;
  }

  if (!items.length) {
    list.innerHTML = '<div class="fav-empty">还没有收藏。点节点标题栏的 ⭐ 收藏。</div>';
    return;
  }

  list.innerHTML = items.map(it => {
    const kind = KIND_LABEL[it.meta?.nodeKind] || it.meta?.nodeKind || '节点';
    const chars = it.meta?.chars || 0;
    return `
      <div class="fav-item${it.id === currentId ? ' active' : ''}" data-id="${escapeHtml(it.id)}">
        <div class="fav-main">
          <div class="fav-name">${escapeHtml(it.name)}</div>
          <div class="fav-sub">${kind}${it.meta?.hasImage ? ' · 图片' : ''} · ${chars} 字 · ${fmtTime(it.createdAt)}</div>
        </div>
        <button class="fav-del" title="删除收藏" data-del="${escapeHtml(it.id)}">🗑</button>
      </div>`;
  }).join('');

  // 未选中任何项时自动选第一条，避免预览区空着
  if (!currentId || !items.some(i => i.id === currentId)) {
    await showFavorite(items[0].id);
  }
}

export async function showFavorite(id) {
  const box = el('favPreview');
  if (!box) return;
  currentId = id;
  releaseBlobUrl();

  const found = await getFavorite(id);
  if (!found) {
    box.innerHTML = '<div class="fav-empty">收藏不存在或数据损坏。</div>';
    return;
  }
  const { item, imageUrl } = found;
  currentBlobUrl = imageUrl;
  const d = item.data || {};
  const kind = d.kind || 'doc';

  let bodyHtml = '';
  if (kind === 'img') {
    bodyHtml = imageUrl
      ? `<img class="fav-img" src="${escapeHtml(imageUrl)}" alt="">`
      : '<div class="fav-empty">图片数据缺失</div>';
  } else if (kind === 'exec') {
    bodyHtml =
      `<div class="fav-label">提示词</div><pre class="fav-pre">${escapeHtml(d.prompt || '（空）')}</pre>` +
      `<div class="fav-label">结果</div><div class="fav-md">${renderMarkdown(d.text || '（空）')}</div>`;
  } else {
    bodyHtml = `<div class="fav-md">${renderMarkdown(d.text || '（空）')}</div>`;
  }

  box.innerHTML = `
    <div class="fav-head">
      <span class="fav-title">${escapeHtml(d.title || item.name)}</span>
      <span class="spacer"></span>
      <button id="favImport">⬇ 导入到画布</button>
    </div>
    <div class="fav-body">${bodyHtml}</div>
  `;

  el('favImport')?.addEventListener('click', () => importFavorite(id));

  // 列表高亮同步
  document.querySelectorAll('#favList .fav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.id === id));
}

// 导入到当前视口中心
export async function importFavorite(id) {
  try {
    const center = viewportCenterWorld();
    const newId = await restoreNode(id, center);
    if (!newId) { toast('❌ 导入失败'); return; }
    toast('✅ 已导入到画布');
  } catch (e) {
    DBG.err('导入收藏失败：', e);
    toast('❌ 导入失败：' + e.message);
  }
}

// 视口中心换算成 world 坐标（#canvasWrap 中心，而不是全屏中心：
// 侧栏展开时两者不同，用全屏中心会让节点落在侧栏下面）
export function viewportCenterWorld() {
  const wrap = document.getElementById('canvasWrap');
  const canvas = document.getElementById('canvas');
  if (!wrap || !canvas) return { x: 0, y: 0 };
  const r = wrap.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  const sx = r.left + r.width / 2;
  const sy = r.top + r.height / 2;
  return {
    x: (sx - c.left - view.x) / view.scale,
    y: (sy - c.top - view.y) / view.scale,
  };
}

function toast(msg) {
  HOST.flashToast?.(msg);
}

// 收藏当前选中节点：⭐ 按钮与面板按钮共用
export async function favoriteSelectedNode() {
  const id = state.selectedNodeId;
  if (!id || !state.nodes[id]) {
    toast('请先选中一个节点');
    return null;
  }
  try {
    const fid = await favoriteNode(id);
    if (fid) {
      toast('⭐ 已收藏');
      await refreshFavoritesPanel();
    }
    return fid;
  } catch (e) {
    DBG.err('收藏失败：', e);
    toast('❌ ' + e.message);
    return null;
  }
}

// ---- 面板事件装配 ----
export function bindFavorites() {
  const openBtn = el('openFavorites');
  const closeBtn = el('favClose');
  const list = el('favList');
  if (!openBtn) return;

  openBtn.addEventListener('click', () => {
    const panel = el('favPanel');
    if (panel && !panel.hidden) closeFavoritesPanel();
    else openFavoritesPanel();
  });

  closeBtn?.addEventListener('click', closeFavoritesPanel);

  list?.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      if (!confirm('删除这条收藏？')) return;
      try {
        await removeFavorite(id);
        if (currentId === id) currentId = null;
        await refreshFavoritesPanel();
        toast('🗑 已删除收藏');
      } catch (err) {
        DBG.err('删除收藏失败：', err);
        toast('❌ 删除失败：' + err.message);
      }
      return;
    }
    const row = e.target.closest('.fav-item');
    if (row) showFavorite(row.dataset.id);
  });

  // 首次打开时若降级，明确告知容量受限
  storeBackendName().then(b => {
    if (b === 'local') {
      openBtn.title = '收藏（当前环境已降级为 localStorage，容量受限）';
    }
  });
}

export function __favoritesTestHooks() {
  return { viewportCenterWorld, showFavorite, importFavorite };
}
