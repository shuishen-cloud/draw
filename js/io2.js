import { DBG, HOST, seq, state, view } from './state.js';
import { refreshSnapshot } from './chat.js';
import { addEdge, redrawEdges } from './edges.js';
import { readAsText } from './io1.js';
import { createNode, refreshAllZonePickers } from './nodes.js';
import { refreshOutline } from './outline.js';
import { createTask, refreshTasks } from './tasks.js';
import { applyView } from './viewport.js';
import { createZone, layoutZone } from './zones.js';
import {
  dedupeByMessageId, mapCardsToNodes, normalizeChatToolPayload, planLayout,
} from './chattool.js';
// 11.99 画布保存 / 导出 / 导入
// =========================================================================
// 把当前画布导出为纯数据对象（含图片 dataURL）
export function exportCanvasData() {
  return {
    format: 'mutiplechat-canvas',
    version: 1,
    savedAt: new Date().toISOString(),
    view: { x: view.x, y: view.y, scale: view.scale },
    nodes: Object.values(state.nodes).map(n => ({
      id: n.id, kind: n.kind, title: n.title,
      x: n.x, y: n.y, w: n.w, h: n.h,
      text: n.text || '', src: n.src || '', prompt: n.prompt || '',
      zoneId: n.zoneId || null, level: n.level || 1,
      // 来源元信息（ChatTool 卡片），有则带上，保证「保存→重开」后去重仍有效
      ...(n.origin ? { origin: n.origin } : {}),
    })),
    edges: Object.values(state.edges).map(e => ({
      id: e.id, source: e.source, target: e.target, command: e.command || '',
    })),
    zones: Object.values(state.zones).map(z => ({
      id: z.id, title: z.title, x: z.x, y: z.y, w: z.w, h: z.h,
      color: z.color, level: z.level || 1,
    })),
    tasks: Object.values(state.tasks).map(t => ({ name: t.name, edgeIds: [...t.edgeIds] })),
  };
}

// 从数据对象重建整个画布
export function importCanvasData(data) {
  if (!data || data.format !== 'mutiplechat-canvas') {
    throw new Error('不是有效的画布文件');
  }
  HOST.__silentImport = true;   // 导入期间跳过逐项副作用，避免卡顿
  try {
    clearCanvas();

  // 区域
  for (const z of data.zones || []) {
    const zone = createZone({ title: z.title, x: z.x, y: z.y, w: z.w, h: z.h, color: z.color, level: z.level });
    // 保持原 id，以便节点归属引用一致
    const old = state.zones[zone.id];
    delete state.zones[zone.id];
    zone.id = z.id;
    zone.el.id = 'zone-' + z.id;
    state.zones[z.id] = zone;
    layoutZone(zone);
    void old;
  }

  // 节点
  for (const n of data.nodes || []) {
    const node = createNode(n.kind, {
      title: n.title, x: n.x, y: n.y, w: n.w, h: n.h,
      text: n.text, src: n.src, prompt: n.prompt,
      zoneId: n.zoneId, level: n.level,
      origin: n.origin || null,
    });
    // 保持原 id，保证连线引用一致
    const oldId = node.id;
    delete state.nodes[oldId];
    node.id = n.id;
    node.el.id = 'node-' + n.id;
    state.nodes[n.id] = node;
  }

  // 连线（此时节点都已就位）
  for (const e of data.edges || []) {
    if (!state.nodes[e.source] || !state.nodes[e.target]) continue;
    const edge = addEdge(e.source, e.target);
    edge.command = e.command || '';
  }

  // 任务
  seq.task = 0;
  state.tasks = {};
  for (const t of data.tasks || []) createTask(t.name, t.edgeIds);

  // 同步 seq 计数器，避免后续 id 冲突
  seq.node = Math.max(0, ...Object.keys(state.nodes).map(k => parseInt(String(k).replace(/\D/g, ''), 10) || 0));
  seq.edge = Math.max(0, ...Object.keys(state.edges).map(k => parseInt(String(k).replace(/\D/g, ''), 10) || 0));
  seq.zone = Math.max(0, ...Object.keys(state.zones).map(k => parseInt(String(k).replace(/\D/g, ''), 10) || 0));

  // 视图
  if (data.view) { view.x = data.view.x; view.y = data.view.y; view.scale = data.view.scale; }

  refreshAllZonePickers();
  applyView();
  redrawEdges();
  refreshOutline();
  refreshTasks();
  refreshSnapshot();
  DBG.log('画布已导入：', (data.nodes || []).length, '节点,', (data.edges || []).length, '连线');
  } finally {
    HOST.__silentImport = false;
  }
}

// =========================================================================
// 追加导入（上层 ChatTool 传送的收藏卡片）
// =========================================================================
// 与 importCanvasData 的根本区别：**不清空、不重置 seq、不动 view**。
//  importCanvasData 是「打开一个画布文件」→ 整板替换；
//  appendCanvasData   是「再放几张卡片上去」→ 只增不减。
// 用整板替换的路径接卡片会把用户正在画的图抹掉（事故隐患）。
//
export function appendCanvasData(raw) {
  const payload = normalizeChatToolPayload(raw);   // 非法数据在这里抛错
  const descs = mapCardsToNodes(payload);

  const existing = Object.values(state.nodes);
  const { kept, skipped } = dedupeByMessageId(descs, existing);
  const placed = planLayout(kept, existing);

  // 建节点，并记下「外部节点 id -> 本地节点 id」供连边用。
  // 不能靠下标对应：去重后 kept 已经短了一层，下标会对不上。
  // __silentImport：与 importCanvasData 同思路，批量建节点时抑制逐项副作用
  // （否则每建一张卡都跑一次 refreshOutline / scheduleSnapshot，几十张就明显卡）。
  // 结束后自己汇总刷新一次。
  const extToLocal = new Map();
  HOST.__silentImport = true;
  try {
    for (const d of placed) {
      const node = createNode(d.kind, {
        title: d.title, text: d.text, src: d.src, prompt: d.prompt,
        x: d.x, y: d.y, w: d.w, h: d.h,
        origin: d.origin,
      });
      if (d.srcId) extToLocal.set(String(d.srcId), node.id);
    }
  } finally {
    HOST.__silentImport = false;
  }

  // 外部边：ChatTool 目前只发卡片不发边，但按通用规则处理——
  // 端点必须在「本次新建」或「画布已有」里找得到，否则跳过（不造脏边）。
  let skippedEdges = 0;
  for (const e of payload.edges) {
    const source = extToLocal.get(String(e.source));
    const target = extToLocal.get(String(e.target));
    if (!source || !target) { skippedEdges++; continue; }
    const edge = addEdge(source, target);
    edge.command = e.command || '';
  }
  if (skippedEdges) DBG.warn('追加导入：跳过', skippedEdges, '条端点缺失的边');

  if (extToLocal.size) {
    refreshAllZonePickers();
    redrawEdges();
    refreshOutline();
    refreshSnapshot();
    autosaveCanvas();
  }

  DBG.log('从 ChatTool 追加：', payload.nodes.length, '张卡片，新增',
    extToLocal.size, '，跳过', skipped.length, '（已存在）');
  return { added: extToLocal.size, skipped: skipped.length };
}

// 清空整个画布
export function clearCanvas() {
  Object.values(state.edges).forEach(e => e.labelEl?.remove());
  Object.values(state.nodes).forEach(n => n.el?.remove());
  Object.values(state.zones).forEach(z => z.el?.remove());
  // 增量渲染不再整层清空 SVG，这里必须显式移除残留的线，否则导入后旧线还在
  document.querySelectorAll('#edges path.wire, #edges path.ghost').forEach(p => p.remove());
  state.nodes = {}; state.edges = {}; state.zones = {};
  state.tasks = {}; state.selectedEdgeId = null; state.activeTaskId = null;
  state.filterZoneId = 'all';
  seq.node = 0; seq.edge = 0; seq.zone = 0; seq.task = 0;
  const msgs = document.getElementById('msgs');
  if (msgs) msgs.innerHTML = '';
  DBG.log('画布已清空');
}


// ---- localStorage 自动保存 ----
// 多画布：正文写到「当前画布 id」对应的键（mc_canvas:<id>），
// 不再写单键 mc_canvas，否则所有画布会互相覆盖。
import { activeCanvasId, ensureRepo, keyOf, saveCurrent } from './canvases.js';

let autosaveTimer = null;
export function autosaveCanvas() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      if (saveCurrent()) DBG.log('已自动保存到本地');
    } catch (e) {
      // 通常是图片太大超出 localStorage 限额
      DBG.warn('自动保存失败（可能图片太大）：', e.message);
    }
  }, 500);
}

// 立即落盘（同步），用于切换画布/手动保存这种「不能等防抖」的场景
export function flushCanvas() {
  clearTimeout(autosaveTimer);
  return saveCurrent();
}

// 恢复：先保证仓库可用（含旧数据迁移），再载入当前画布。
// 注意：空画布也算「恢复成功」，但 main.js 需要区分「有内容」与「空」——
// 首屏空画布应该铺示例节点，否则新用户看到一片白。
// 故返回值改为：false = 没东西可显示（含空画布/读取失败）。
export function restoreCanvas() {
  ensureRepo();
  const id = activeCanvasId();
  if (!id) return false;
  const raw = localStorage.getItem(keyOf(id));
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    const hasContent = (data.nodes || []).length > 0 || (data.zones || []).length > 0;
    importCanvasData(data);
    DBG.log('已从本地恢复画布：', id, hasContent ? '' : '（空画布）');
    return hasContent;
  } catch (e) {
    DBG.warn('本地画布恢复失败：', e.message);
    return false;
  }
}

// ---- 导出 / 导入文件 ----
export function exportToFile() {
  const data = exportCanvasData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `canvas-${ts}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  DBG.log('已导出 JSON 文件');
}

export async function importFromFile(file) {
  try {
    const text = await readAsText(file);
    const data = JSON.parse(text);
    importCanvasData(data);
    autosaveCanvas();
  } catch (e) {
    DBG.err('导入失败：', e);
    alert('导入失败：' + e.message);
  }
}

// =========================================================================
