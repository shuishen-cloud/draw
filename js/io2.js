import { DBG, seq, state, view } from './state.js';
import { refreshSnapshot } from './chat.js';
import { addEdge, redrawEdges } from './edges.js';
import { readAsText } from './io1.js';
import { createNode, refreshAllZonePickers } from './nodes.js';
import { refreshOutline } from './outline.js';
import { createTask, refreshTasks } from './tasks.js';
import { applyView } from './viewport.js';
import { createZone, layoutZone } from './zones.js';
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
  window.__silentImport = true;   // 导入期间跳过逐项副作用，避免卡顿
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
    window.__silentImport = false;
  }
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
let autosaveTimer = null;
export function autosaveCanvas() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem('mc_canvas', JSON.stringify(exportCanvasData()));
      DBG.log('已自动保存到本地');
    } catch (e) {
      // 通常是图片太大超出 localStorage 限额
      DBG.warn('自动保存失败（可能图片太大）：', e.message);
    }
  }, 500);
}

export function restoreCanvas() {
  const raw = localStorage.getItem('mc_canvas');
  if (!raw) return false;
  try {
    importCanvasData(JSON.parse(raw));
    DBG.log('已从本地恢复上次画布');
    return true;
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
