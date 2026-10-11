import { DBG, PREFIX, escapeHtml, seq, state } from './state.js';
import { redrawEdges } from './edges.js';
import { runEdge } from './exec.js';
import { refreshOutline } from './outline.js';
import { runExecNode } from './run.js';
// 11.97 任务系统 + 拓扑执行
// =========================================================================

// 给连线一个可读标签（用于任务面板展示）：N1 → N2（命令）
export function edgeLabelText(edge) {
  const nodes = Object.values(state.nodes).sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const idx = (id) => 'N' + (nodes.findIndex(n => n.id === id) + 1);
  const src = state.nodes[edge.source], dst = state.nodes[edge.target];
  if (!src || !dst) return edge.id;
  const cmd = (edge.command || '').trim();
  const cmdTxt = cmd.startsWith(PREFIX) ? cmd.slice(PREFIX.length).trim() : (cmd || '无命令');
  return `${idx(edge.source)} → ${idx(edge.target)} （${cmdTxt}）`;
}

export function createTask(name, edgeIds = []) {
  const id = 't' + (++seq.task);
  const task = { id, name: name || ('任务 ' + seq.task), edgeIds: [...edgeIds] };
  state.tasks[id] = task;
  saveTasks();
  refreshTasks();
  DBG.log('创建任务', id, task.name, '含', task.edgeIds.length, '条线');
  return task;
}

export function removeTask(id) {
  delete state.tasks[id];
  if (state.activeTaskId === id) state.activeTaskId = null;
  saveTasks();
  refreshTasks();
  redrawEdges();
}

export function toggleEdgeInTask(taskId, edgeId) {
  const t = state.tasks[taskId];
  if (!t) return;
  const i = t.edgeIds.indexOf(edgeId);
  if (i >= 0) t.edgeIds.splice(i, 1); else t.edgeIds.push(edgeId);
  saveTasks();
  refreshTasks();
  redrawEdges();
}

// 持久化到 localStorage
export function saveTasks() {
  const data = Object.values(state.tasks).map(t => ({ name: t.name, edgeIds: t.edgeIds }));
  try { localStorage.setItem('mc_tasks', JSON.stringify(data)); } catch (e) { DBG.warn('任务保存失败', e); }
}

export function loadTasks() {
  try {
    const raw = localStorage.getItem('mc_tasks');
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(t => {
      const id = 't' + (++seq.task);
      state.tasks[id] = { id, name: t.name, edgeIds: (t.edgeIds || []).slice() };
    });
    DBG.log('已载入', arr.length, '个任务');
  } catch (e) { DBG.warn('任务载入失败', e); }
}

// 渲染任务面板
export function refreshTasks() {
  const body = document.getElementById('taskBody');
  if (!body) return;
  const tasks = Object.values(state.tasks);
  if (!tasks.length) {
    body.innerHTML = '<div class="task-empty">还没有任务。点击上方「＋新建任务」，然后勾选要包含的连线。</div>';
    return;
  }
  const html = [];
  for (const t of tasks) {
    const active = state.activeTaskId === t.id;
    html.push(`<div class="task-card ${active ? 'active' : ''}" data-task="${t.id}">`);
    html.push(`<div class="task-head">`);
    html.push(`<span class="tname">${escapeHtml(t.name)}</span>`);
    html.push(`<span class="tcount">${t.edgeIds.length} 线</span>`);
    html.push(`<span class="trun" data-run="${t.id}" title="运行此任务">▶ 运行</span>`);
    html.push(`</div>`);
    html.push(`<div class="task-lines">`);
    if (!t.edgeIds.length) {
      html.push(`<div class="task-empty">（未选连线）</div>`);
    } else {
      for (const eid of t.edgeIds) {
        const e = state.edges[eid];
        const label = e ? edgeLabelText(e) : '(已删除的线)';
        html.push(`<div class="task-line" data-edge-in="${eid}">`);
        html.push(`<input type="checkbox" checked disabled>`);
        html.push(`<span>${escapeHtml(label)}</span>`);
        html.push(`<span class="grow" style="flex:1"></span>`);
        html.push(`<span data-remove="${t.id}|${eid}" style="color:#dc2626" title="移出任务">×</span>`);
        html.push(`</div>`);
      }
    }
    html.push(`</div>`);
    html.push(`<div class="task-actions">`);
    html.push(`<button data-rename="${t.id}">重命名</button>`);
    html.push(`<button data-select="${t.id}">选中其线</button>`);
    html.push(`<button class="danger" data-del="${t.id}">删除任务</button>`);
    html.push(`</div></div>`);
  }
  body.innerHTML = html.join('');

  // 事件
  body.querySelectorAll('[data-run]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); runTask(el.dataset.run);
  }));
  body.querySelectorAll('[data-remove]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const [tid, eid] = el.dataset.remove.split('|');
    toggleEdgeInTask(tid, eid);
  }));
  body.querySelectorAll('[data-rename]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = state.tasks[el.dataset.rename];
    const n = prompt('任务名称：', t.name);
    if (n !== null) { t.name = n; saveTasks(); refreshTasks(); refreshOutline(); }
  }));
  body.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); removeTask(el.dataset.del);
  }));
  body.querySelectorAll('[data-select]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    state.activeTaskId = el.dataset.select;
    refreshTasks(); redrawEdges();
  }));
  body.querySelectorAll('.task-card').forEach(el => el.addEventListener('click', () => {
    state.activeTaskId = el.dataset.task;
    refreshTasks(); redrawEdges();
  }));
}

// 将任务内的边按拓扑依赖顺序排序（上游先执行）
// 只要任务边集里存在 A→B 且 B 的结果被后续使用，就保证顺序
export function topoSortEdges(edgeIds) {
  const set = new Set(edgeIds.filter(id => state.edges[id]));
  // 构造“节点依赖”：边的 target 节点必须在其 source 节点之后处理
  // 简化做法：按目标节点的拓扑层级排序（用重复松弛）
  const edges = [...set].map(id => state.edges[id]);
  // 计算每个节点的深度（无环图）：depth(node) = max(depth(pred)) + 1
  const depth = {};
  Object.keys(state.nodes).forEach(n => depth[n] = 0);
  for (let iter = 0; iter < Object.keys(state.nodes).length + 2; iter++) {
    let changed = false;
    for (const e of edges) {
      if (depth[e.target] < depth[e.source] + 1) {
        depth[e.target] = depth[e.source] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return edges.sort((a, b) => depth[a.target] - depth[b.target]);
}

// 运行一个任务：按拓扑顺序跑任务内的所有连线，再跑相关的执行节点
export async function runTask(taskId) {
  const t = state.tasks[taskId];
  if (!t) return;
  state.activeTaskId = taskId;
  refreshTasks();
  const ordered = topoSortEdges(t.edgeIds);
  DBG.log('========== 运行任务', t.name, '共', ordered.length, '条线 ==========');

  for (const e of ordered) await runEdge(e.id);

  // 任务内所有被指的 exec 节点，按拓扑顺序跑
  const execIds = new Set();
  for (const e of ordered) {
    const dst = state.nodes[e.target];
    if (dst && dst.kind === 'exec') execIds.add(dst.id);
  }
  const execs = [...execIds].map(id => state.nodes[id])
    .sort((a, b) => (depthOf(a.id) - depthOf(b.id)));
  for (const n of execs) await runExecNode(n.id);
  DBG.log('========== 任务', t.name, '完成 ==========');
}

export function depthOf(nodeId) {
  // 简单计算：从起点到该节点的最长路径（用于 exec 排序）
  const edges = Object.values(state.edges);
  const depth = {};
  Object.keys(state.nodes).forEach(n => depth[n] = 0);
  for (let i = 0; i < Object.keys(state.nodes).length + 2; i++) {
    let ch = false;
    for (const e of edges) if (depth[e.target] < depth[e.source] + 1) { depth[e.target] = depth[e.source] + 1; ch = true; }
    if (!ch) break;
  }
  return depth[nodeId] || 0;
}

// 左侧 Tab 切换
export function switchOlTab(tab) {
  state.olTab = tab;
  document.querySelectorAll('.ol-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('paneOutline').style.display = tab === 'outline' ? 'flex' : 'none';
  document.getElementById('paneTasks').style.display = tab === 'tasks' ? 'flex' : 'none';
}

// =========================================================================
