// =========================================================================
// favorites.js —— 收藏（节点）
//
// 设计要点（见 doc/feat/favorites-node.md）：
//   - 元数据与图片分表：items 里只存 srcKey，图片放 blobs（Blob）
//   - 查阅优先：preview 只读渲染，不碰画布
//   - 导入其次：restoreNode 在指定 world 坐标生成新节点
//   - 降级到 localStorage 时，图片以 dataURL 内联进 data.src
// =========================================================================
import { DBG, HOST, PREFIX, escapeHtml, state, view } from './state.js';
import { createNode, refreshAllZonePickers, selectNode } from './nodes.js';
import { addEdge, redrawEdges } from './edges.js';
import { renderMarkdown } from './md.js';
import {
  STORE_BLOBS, STORE_ITEMS, blobToDataURL, dataURLToBlob, openStore, storeBackendName,
} from './store.js';
import { refreshOutline } from './outline.js';
import { boundsOf, centerOffset, pickSubgraph } from './subgraph.js';
import { appendCanvasData } from './io2.js';
import {
  CHATTOOL_DRAW_URL, ORIGIN_SOURCE,
  mapCardsToNodes, normalizeChatToolPayload, toFavoriteItems,
} from './chattool.js';

let favSeq = 0;

function newFavId() {
  // 必须跨标签页唯一：两个标签页同一毫秒收藏时，
  // 仅用「时间戳+序号」会生成相同 id（序号是各自进程内的），
  // 后写覆盖先写 → 丢收藏。优先用 crypto.randomUUID，
  // 不可用时回落到「时间戳+随机数+序号」。
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return 'f' + c.randomUUID(); } catch { /* 回退 */ }
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return 'f' + Date.now().toString(36) + '-' + rand + '-' + (++favSeq).toString(36);
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
    .filter(x => x && (x.kind === 'node' || x.kind === 'subgraph' || x.kind === 'chattool'))
    // kind 过滤：旧的 node 收藏保持原样，子图收藏一并列出
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
    // 来自 ChatTool 的收藏带 origin：不传的话逐条导入会丢失来源，
    // 再次导入就无法按 messageId 去重（会叠出重复卡片）。
    origin: d.origin || null,
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
// 子图收藏（框选）
// =========================================================================
// 收藏一个矩形选区内的节点与「两端都在选区内」的边。
// rect 为 world 坐标；返回收藏 id，选区为空返回 null。
export async function favoriteSubgraph(rect, name) {
  const nodes = Object.values(state.nodes);
  const edges = Object.values(state.edges);
  const snap = pickSubgraph(rect, nodes, edges);

  if (!snap.nodes.length) {
    DBG.warn('框选区域内没有节点，取消收藏');
    HOST.flashToast?.('框选区域内没有节点');
    return null;
  }

  const store = await openStore();
  const id = newFavId();

  // 图片节点：idb 后端把 Blob 存进 blobs 表，元数据只留 srcKey
  let hasImage = false;
  for (const n of snap.nodes) {
    if (n.kind !== 'img' || !n.src) { delete n.src; continue; }
    hasImage = true;
    if (store.backend === 'idb') {
      const blob = dataURLToBlob(n.src);
      if (blob) {
        const key = 'fb-' + id + '-' + n.id;
        await store.put(STORE_BLOBS, { key, blob, type: blob.type || 'image/png' });
        n.srcKey = key;
        delete n.src;
      }
    }
  }

  const item = {
    id,
    kind: 'subgraph',
    name: (name || '').trim() || ('框选 ' + snap.nodes.length + ' 节点'),
    createdAt: new Date().toISOString(),
    meta: {
      nodeCount: snap.nodes.length,
      edgeCount: snap.edges.length,
      hasImage,
    },
    data: { nodes: snap.nodes, edges: snap.edges, bounds: snap.bounds },
  };

  try {
    await store.put(STORE_ITEMS, item);
  } catch (e) {
    DBG.err('子图收藏写入失败：', e);
    throw e;
  }
  DBG.log('已收藏子图', id, snap.nodes.length, '节点 /', snap.edges.length, '连线');
  HOST.flashToast?.(`⭐ 已收藏 ${snap.nodes.length} 节点 / ${snap.edges.length} 连线`);
  return id;
}

// 取子图快照，并把图片 srcKey 解析成可用 URL（写入节点的 src 字段）
async function loadSubgraphSnapshot(id) {
  const store = await openStore();
  const item = await store.get(STORE_ITEMS, id);
  if (!item || item.kind !== 'subgraph') return null;

  const nodes = [];
  for (const n of item.data?.nodes || []) {
    const copy = { ...n };
    if (n.srcKey) {
      const rec = await store.get(STORE_BLOBS, n.srcKey);
      if (rec?.blob) {
        copy.src = URL.createObjectURL(rec.blob);
        copy.__blobUrl = copy.src;
      } else {
        DBG.warn('子图中的图片缺失', n.id);
        copy.src = '';
      }
    }
    nodes.push(copy);
  }
  return { item, nodes, edges: item.data?.edges || [] };
}

// 导入子图：全部重新分配 id，内部边重连，整体居中到 pos
export async function restoreSubgraph(id, pos = {}) {
  const snap = await loadSubgraphSnapshot(id);
  if (!snap) { DBG.warn('导入失败：子图收藏不存在', id); return null; }

  const { item, nodes, edges } = snap;
  const offset = centerOffset(item.data?.bounds || boundsOf(nodes), pos);

  // 关键：新 id 必须由 createNode 实际分配，不能预先用工厂「猜」——
  // createNode 内部会 ++seq.node，预先分配的 id 与实际创建的对不上，
  // 边就会指向不存在的新节点（表现为「导入后连线消失」）。
  // 故先建节点、边用「旧 id -> 新 id」的真实映射表重连。
  const created = [];
  const idMap = new Map();          // 旧节点 id -> 实际新节点 id
  for (const n of nodes) {
    const node = createNode(n.kind, {
      title: n.title,
      text: n.text,
      prompt: n.prompt,
      src: n.src || '',
      w: Math.max(60, Number(n.w) || 200),
      h: Math.max(40, Number(n.h) || 120),
      x: Math.round((Number(n.x) || 0) + offset.dx),
      y: Math.round((Number(n.y) || 0) + offset.dy),
    });
    idMap.set(n.id, node.id);
    created.push(node.id);
    if (n.__blobUrl) {
      // 节点接管该 URL 的生命周期：图被替换或页面关闭时浏览器会回收
      node.__favBlobUrl = n.__blobUrl;
    }
  }

  const createdEdges = [];
  for (const e of edges) {
    const source = idMap.get(e.source);
    const target = idMap.get(e.target);
    if (!source || !target) {
      DBG.warn('导入子图：连线端点缺失，已跳过', e.id);
      continue;
    }
    const edge = addEdge(source, target);
    edge.command = e.command || '';     // 命令是子图语义的一部分，必须保留
    createdEdges.push(edge.id);
  }

  refreshAllZonePickers();
  refreshOutline();
  redrawEdges();
  HOST.scheduleSnapshot?.();
  DBG.log('已导入子图', id, '->', created.length, '节点,', createdEdges.length, '连线');
  return { nodeIds: created, edgeIds: createdEdges };
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
    let sub;
    if (it.kind === 'subgraph') {
      sub = `⬚ 子图 · ${it.meta?.nodeCount || 0} 节点 / ${it.meta?.edgeCount || 0} 连线`
          + (it.meta?.hasImage ? ' · 图片' : '')
          + ` · ${fmtTime(it.createdAt)}`;
    } else if (it.kind === 'chattool') {
      // 来自 ChatTool 的收件箱条目：突出「来源会话 · 角色 · 标签」
      const src = it.meta?.convTitle ? `《${it.meta.convTitle}》` : 'ChatTool';
      const role = it.meta?.role ? ` · ${it.meta.role}` : '';
      const tags = it.meta?.tags?.length ? ` · ${it.meta.tags.join('、')}` : '';
      sub = `💬 ${src}${role}${tags} · ${it.meta?.chars || 0} 字`;
    } else {
      const kind = KIND_LABEL[it.meta?.nodeKind] || it.meta?.nodeKind || '节点';
      sub = `${kind}${it.meta?.hasImage ? ' · 图片' : ''} · ${it.meta?.chars || 0} 字 · ${fmtTime(it.createdAt)}`;
    }
    return `
      <div class="fav-item${it.id === currentId ? ' active' : ''}" data-id="${escapeHtml(it.id)}">
        <div class="fav-main">
          <div class="fav-name">${escapeHtml(it.name)}</div>
          <div class="fav-sub">${escapeHtml(sub)}</div>
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

  // 子图收藏：结构与单节点完全不同，单独分支
  if (item.kind === 'subgraph') {
    await renderSubgraphPreview(item, box);
    return;
  }

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
    ${item.kind === 'chattool' ? `<div class="fav-sub-line">💬 来自 ChatTool`
      + (item.meta?.convTitle ? ` · 《${escapeHtml(item.meta.convTitle)}》` : '')
      + (item.meta?.role ? ` · ${escapeHtml(item.meta.role)}` : '')
      + (item.meta?.tags?.length ? ` · ${escapeHtml(item.meta.tags.join('、'))}` : '')
      + (item.meta?.favoriteAt ? ` · ${escapeHtml(fmtTime(item.meta.favoriteAt))}` : '')
      + `</div>` : ''}
    <div class="fav-body">${bodyHtml}</div>
  `;

  el('favImport')?.addEventListener('click', () => importFavorite(id));

  // 列表高亮同步
  document.querySelectorAll('#favList .fav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.id === id));
}

// 子图预览：用文本结构呈现，比缩略图可读（多节点时缩略图会糊成一团）
async function renderSubgraphPreview(item, box) {
  const snap = await loadSubgraphSnapshot(item.id);
  if (!snap) {
    box.innerHTML = '<div class="fav-empty">子图数据损坏。</div>';
    return;
  }
  const { nodes, edges } = snap;
  // 释放上一张预览可能创建的 blob url
  for (const n of nodes) if (n.__blobUrl) { /* 预览里直接用，不立即释放 */ }

  const label = (id) => {
    const n = nodes.find(x => x.id === id);
    return n ? (n.title || n.kind) : id;
  };
  const kindLabel = { doc: '文档', output: '输出', img: '图片', exec: '执行' };

  const nodeRows = nodes.map(n => {
    let summary = '';
    if (n.kind === 'img') summary = '<span class="fav-dim">（图片）</span>';
    else {
      const t = (n.text || n.prompt || '').replace(/\s+/g, ' ').trim();
      summary = t
        ? `<div class="fav-md fav-sub-md">${renderMarkdown(t.length > 300 ? t.slice(0, 300) + '…' : t)}</div>`
        : '<span class="fav-dim">（空）</span>';
    }
    return `
      <div class="fav-node-row">
        <div class="fav-node-head">
          <span class="fav-tag">${escapeHtml(kindLabel[n.kind] || n.kind)}</span>
          <span class="fav-node-title">${escapeHtml(n.title || '')}</span>
        </div>
        ${summary}
      </div>`;
  }).join('');

  const edgeRows = edges.length
    ? edges.map(e => {
        const cmd = (e.command || '').startsWith(PREFIX)
          ? (e.command || '').slice(PREFIX.length).trim()
          : (e.command || '');
        return `<div class="fav-edge-row">${escapeHtml(label(e.source))} → ${escapeHtml(label(e.target))}`
             + (cmd ? ` <span class="fav-dim">（${escapeHtml(cmd)}）</span>` : '')
             + '</div>';
      }).join('')
    : '<div class="fav-dim">（无连线）</div>';

  box.innerHTML = `
    <div class="fav-head">
      <span class="fav-title">${escapeHtml(item.name)}</span>
      <span class="spacer"></span>
      <button id="favImport">⬇ 导入到画布</button>
    </div>
    <div class="fav-sub-line">⬚ 子图 · ${nodes.length} 节点 / ${edges.length} 连线</div>
    <div class="fav-body">
      <div class="fav-label">节点</div>
      ${nodeRows}
      <div class="fav-label">连线</div>
      ${edgeRows}
    </div>
  `;
  el('favImport')?.addEventListener('click', () => importFavorite(item.id));
  document.querySelectorAll('#favList .fav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.id === item.id));
}

// 导入到当前视口中心（自动区分单节点 / 子图）
export async function importFavorite(id) {
  try {
    const center = viewportCenterWorld();
    const store = await openStore();
    const item = await store.get('items', id);
    if (!item) { toast('❌ 收藏不存在'); return; }

    if (item.kind === 'subgraph') {
      const r = await restoreSubgraph(id, center);
      if (!r) { toast('❌ 导入失败'); return; }
      toast(`✅ 已导入 ${r.nodeIds.length} 节点 / ${r.edgeIds.length} 连线`);
      return;
    }

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

// ---- 从上层 ChatTool 拉取收藏卡片（追加到当前画布）----
// 与「⬇ 导入收藏」不同：这里是跨应用拉取，且**不清空**当前画布。
// 失败时给出可操作退路：ChatTool 未启动 / 端口不同 / 纯离线版。
// ---- 从上层 ChatTool 拉取收藏卡片（收件箱模式）----
// 关键变化（v2）：拉取**不直接落画布**，而是先写成收藏条目（kind='chattool'），
// 用户在收藏面板里预览、逐条或批量导入。理由：直接铺满画布会把整理好的布局推乱，
// 而且删错了以后 origin 也丢了、再拉一次全部重来。

export async function importFromChatTool(url = CHATTOOL_DRAW_URL) {
  let raw;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ChatTool 返回 HTTP ${res.status}`);
    raw = await res.json();
  } catch (e) {
    DBG.err('拉取 ChatTool 失败：', e);
    const hint = /Failed to fetch|NetworkError|load failed/i.test(String(e.message))
      ? '连不上 ChatTool（' + url + '）。请确认 ChatTool 已启动，或改用 ChatTool 的「导出」再点「⬆ 导入」。'
      : e.message;
    throw new Error(hint);
  }
  return pullChatToolToFavorites(raw);
}

/**
 * 把 ChatTool 的返回体写入收藏库（不动画布）。
 * 第二个参数用于测试注入 payload（不传则按 payloadOrUrl 当作数据）。
 * 返回 {added, skipped}。
 */
export async function pullChatToolToFavorites(payloadOrUrl, maybePayload) {
  let raw = maybePayload;
  if (raw === undefined) {
    if (typeof payloadOrUrl === 'string') return importFromChatTool(payloadOrUrl);
    raw = payloadOrUrl;
  }

  const payload = normalizeChatToolPayload(raw);         // 非法数据在这里抛错
  const descs = mapCardsToNodes(payload);
  const items = toFavoriteItems(descs);

  if (!items.length) {
    DBG.log('ChatTool 拉取：没有卡片');
    return { added: 0, skipped: 0 };
  }

  const store = await openStore();
  const all = await store.getAll(STORE_ITEMS);
  // 去重口径：与收藏库已有条目比，不看画布（画布是另一个层次）
  const existing = new Set(
    all.filter(x => x && x.kind === 'chattool' && x.meta?.messageId)
       .map(x => String(x.meta.messageId)),
  );
  // 同时按 id 去重，兼容没有 messageId 的自由笔记
  const existingIds = new Set(all.filter(x => x && x.id).map(x => x.id));

  let added = 0, skipped = 0;
  for (const it of items) {
    const mid = it.meta?.messageId;
    if ((mid && existing.has(String(mid))) || existingIds.has(it.id)) { skipped++; continue; }
    try {
      await store.put(STORE_ITEMS, it);
      added++;
      if (mid) existing.add(String(mid));
      existingIds.add(it.id);
    } catch (e) {
      // 典型是 localStorage 降级路径下超限。已写入的保留，不全部回退。
      DBG.err('收藏写入失败（已写入', added, '条）：', e);
      throw new Error(`收藏库写入失败（已成功 ${added} 条）：${e.message}`);
    }
  }

  if (added) await refreshFavoritesPanel();
  DBG.log('从 ChatTool 拉取到收藏：新增', added, '条，跳过', skipped, '条（已在收藏里）');
  return { added, skipped };
}

/** 收藏库里所有 chattool 条目（新的在前）。 */
export async function listChatToolFavorites() {
  const store = await openStore();
  const all = await store.getAll(STORE_ITEMS);
  return all
    .filter(x => x && x.kind === 'chattool')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 清空 chattool 收藏（供测试与重置用）。返回删除条数。 */
export async function clearChatToolFavorites() {
  const store = await openStore();
  const list = await listChatToolFavorites();
  for (const it of list) await store.delete(STORE_ITEMS, it.id);
  if (list.length) await refreshFavoritesPanel();
  return list.length;
}

/**
 * 把收藏库里所有 chattool 条目一次导入到当前画布。
 * 走 appendCanvasData：它自带「与画布节点按 messageId 去重」，
 * 所以重复点不会在画布上叠出第二份。
 */
export async function importAllChatToolFavorites() {
  const items = await listChatToolFavorites();
  if (!items.length) return { added: 0, skipped: 0 };

  const payload = {
    format: 'mutiplechat-canvas',
    version: 1,
    nodes: [],
    edges: [],
    zones: [],
    tasks: [],
    draw_cards: [],
  };
  items.forEach((it, i) => {
    const nid = 'ct' + i;
    const d = it.data || {};
    payload.nodes.push({
      id: nid, kind: d.kind, title: d.title || it.name,
      x: 0, y: 0, w: d.w, h: d.h,
      text: d.text, src: d.src, prompt: d.prompt,
    });
    payload.draw_cards.push({
      nodeId: nid,
      messageId: it.meta?.messageId || '',
      convId: d.origin?.convId || '',
      convTitle: it.meta?.convTitle || '',
      role: it.meta?.role || '',
      tags: it.meta?.tags || [],
      favoriteAt: it.meta?.favoriteAt || '',
      source: ORIGIN_SOURCE,
    });
  });

  const res = appendCanvasData(payload);
  DBG.log('全部导入：', res);
  return res;
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

  // 从 ChatTool 拉取收藏卡片：追加到当前画布，不清空、不改视口
  const pullBtn = el('favPullChatTool');
  pullBtn?.addEventListener('click', async () => {
    if (pullBtn.disabled) return;                 // 防连点重复拉
    pullBtn.disabled = true;
    const oldText = pullBtn.textContent;
    pullBtn.textContent = '⏳ 拉取中…';
    try {
      const { added, skipped } = await importFromChatTool();
      if (!added && !skipped) toast('ChatTool 里还没有收藏');
      else if (!added) toast(`已是最新，${skipped} 条都在收藏里`);
      else toast(`✅ 已收进收藏 ${added} 条` + (skipped ? `，跳过 ${skipped} 条（已存在）` : '')
        + '，点条目右侧「⬇」导入到画布');
    } catch (err) {
      DBG.err('从 ChatTool 拉取失败：', err);
      toast('❌ ' + err.message);
    } finally {
      pullBtn.disabled = false;
      pullBtn.textContent = oldText;
    }
  });

  // 一次性把收藏库里所有 ChatTool 条目导入到画布
  const pullAllBtn = el('favPullAll');
  pullAllBtn?.addEventListener('click', async () => {
    if (pullAllBtn.disabled) return;
    pullAllBtn.disabled = true;
    const oldText = pullAllBtn.textContent;
    pullAllBtn.textContent = '⏳ 导入中…';
    try {
      const { added, skipped } = await importAllChatToolFavorites();
      if (!added && !skipped) toast('收藏里还没有来自 ChatTool 的卡片');
      else if (!added) toast(`已在画布上，跳过 ${skipped} 张`);
      else toast(`✅ 已导入 ${added} 张卡片到画布` + (skipped ? `，跳过 ${skipped} 张（已在画布）` : ''));
    } catch (err) {
      DBG.err('全部导入失败：', err);
      toast('❌ ' + err.message);
    } finally {
      pullAllBtn.disabled = false;
      pullAllBtn.textContent = oldText;
    }
  });

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
