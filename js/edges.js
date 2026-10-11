import { DBG, PREFIX, escapeHtml, linkState, seq, state, view } from './state.js';
import { runEdge } from './exec.js';
import { drawMiniMap } from './minimap.js';
import { applyFilter } from './outline.js';
import { toggleEdgeInTask } from './tasks.js';
import { screenToWorld, worldEl } from './viewport.js';
// 6. 连线：从端口拖出
// =========================================================================
export function startLinkFrom(node, e) {
  // 用 world 坐标（因为预览线画在 #edges 里，而 #edges 在 #world 中）
  function endpointXY(ofNode) {
    return { x: ofNode.x + ofNode.w, y: ofNode.y + ofNode.h / 2 };
  }
  const s = endpointXY(node);
  const p = screenToWorld(e.clientX, e.clientY);
  linkState.pending = { source: node.id, x1: s.x, y1: s.y, x2: p.x, y2: p.y };
  function onMove(ev) {
    if (!linkState.pending) return;
    const q = screenToWorld(ev.clientX, ev.clientY);
    linkState.pending.x2 = q.x;
    linkState.pending.y2 = q.y;
    drawGhost(linkState.pending);
  }
  function onUp(ev) {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    // 若松开时落在某个节点上，则正式建边
    const target = findNodeAt(ev.clientX, ev.clientY);
    linkState.pending = null;
    drawGhost(null);
    if (target && target.id !== node.id) {
      addEdge(node.id, target.id);
    } else {
      DBG.log('连线取消（未落在有效节点上）');
    }
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

export function finishLinkTo(node) {
  // 由 linkState.pending 的 mouseup 处理，这里作为兜底入口（端口松手）
  // 实际逻辑在 startLinkFrom 的 onUp 中，通过坐标命中判断。
  void node;
}

export function findNodeAt(cx, cy) {
  for (const n of Object.values(state.nodes)) {
    const r = n.el.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return n;
  }
  return null;
}

export function addEdge(source, target) {
  // 允许重复连线（同一对节点可有多条不同命令的线）
  const id = 'e' + (++seq.edge);
  const edge = { id, source, target, command: '', labelEl: null };
  state.edges[id] = edge;
  createEdgeLabel(edge);
  if (!window.__silentImport) redrawEdges();
  DBG.log('创建连线', id, source, '->', target);
  if (!window.__silentImport) window.scheduleSnapshot?.();
  return edge;
}

// =========================================================================
// 7. 连线渲染
// =========================================================================
export function edgeGeometry(edge) {
  const a = state.nodes[edge.source];
  const b = state.nodes[edge.target];
  if (!a || !b) return null;
  // 直接使用 world 坐标（节点在 world 中，边也画在 world 中）
  const x1 = a.x + a.w, y1 = a.y + a.h / 2;
  const x2 = b.x,       y2 = b.y + b.h / 2;
  return { x1, y1, x2, y2 };
}

export function edgePath({ x1, y1, x2, y2 }) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function redrawEdges() {
  const svg = document.getElementById('edges');
  svg.innerHTML = '';
  for (const edge of Object.values(state.edges)) {
    const g = edgeGeometry(edge);
    if (!g) continue;
    const executable = edge.command.trim().startsWith(PREFIX);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', edgePath(g));
    p.setAttribute('class', 'wire'
      + (executable ? ' executable' : '')
      + (state.selectedEdgeId === edge.id ? ' selected' : '')
      + (edge.running ? ' running' : ''));
    p.dataset.edge = edge.id;
    p.addEventListener('click', () => selectEdge(edge.id));
    p.addEventListener('dblclick', () => editEdgeLabel(edge));
    svg.appendChild(p);
    edge.pathEl = p;
    layoutEdgeLabel(edge);
  }
  drawMiniMap();
  applyFilter();   // 重画后重新应用层级过滤（淡出非当前层）
}

export function drawGhost(link) {
  const svg = document.getElementById('edges');
  let ghost = svg.querySelector('.ghost');
  if (!link) { ghost?.remove(); return; }
  if (!ghost) {
    ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ghost.setAttribute('class', 'ghost');
    svg.appendChild(ghost);
  }
  ghost.setAttribute('d', edgePath(link));
}

// =========================================================================
// 8. 连线命令标签（就地编辑，不弹窗）
// =========================================================================
export function createEdgeLabel(edge) {
  const el = document.createElement('div');
  el.className = 'edge-label placeholder';
  el.textContent = '+ 命令';
  worldEl().appendChild(el);       // 标签也进入 world 坐标系，随缩放平移
  edge.labelEl = el;

  el.addEventListener('click', (e) => { e.stopPropagation(); selectEdge(edge.id); });
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); editEdgeLabel(edge); });
}

export function layoutEdgeLabel(edge) {
  if (!edge.labelEl) return;
  const g = edgeGeometry(edge);
  if (!g) return;
  // edgeGeometry 已是 world 坐标，标签又定位在 #world 内，直接用 mid 坐标
  const mx = (g.x1 + g.x2) / 2;
  const my = (g.y1 + g.y2) / 2;
  edge.labelEl.style.left = mx + 'px';
  edge.labelEl.style.top = my + 'px';

  const cmd = edge.command.trim();
  const executable = cmd.startsWith(PREFIX);
  let text;
  if (cmd) {
    text = escapeHtml(cmd);
    edge.labelEl.classList.remove('placeholder');
  } else {
    text = '+ 命令';
    edge.labelEl.classList.add('placeholder');
  }
  // 若属于当前激活任务，加个小标记
  if (edgeInActiveTask(edge.id)) text += '<span class="task-dot" title="属于当前任务">●</span>';
  edge.labelEl.innerHTML = text;
  edge.labelEl.classList.toggle('executable', executable);
}

export function selectEdge(id) {
  // 若当前正在“任务”Tab 且已选中一个任务，则点击连线 = 切换它是否属于该任务
  if (state.olTab === 'tasks' && state.activeTaskId && state.tasks[state.activeTaskId]) {
    toggleEdgeInTask(state.activeTaskId, id);
    DBG.log('切换连线', id, '在任务', state.activeTaskId, '中的归属');
  }
  state.selectedEdgeId = id;
  redrawEdges();
  DBG.log('选中连线', id, '命令=', JSON.stringify(state.edges[id]?.command));
}

// 某条线是否属于当前激活任务
export function edgeInActiveTask(edgeId) {
  const t = state.tasks[state.activeTaskId];
  return !!(t && t.edgeIds.includes(edgeId));
}

// 就地编辑：把标签替换成一个 input
export function editEdgeLabel(edge) {
  if (edge._editing) return;
  edge._editing = true;
  const label = edge.labelEl;
  const input = document.createElement('input');
  input.className = 'edge-input';
  input.value = edge.command;
  input.placeholder = '🖐️总结';
  input.style.left = label.style.left;
  input.style.top = label.style.top;
  label.style.visibility = 'hidden';
  worldEl().appendChild(input);           // 输入框也放进 world
  input.style.transform = `translate(-50%, -50%) scale(${1 / view.scale})`;
  input.focus();
  input.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    edge._editing = false;
    if (save) {
      edge.command = input.value;
      DBG.log('命令更新:', JSON.stringify(edge.command),
              '| 可执行=', edge.command.trim().startsWith(PREFIX));
      window.scheduleSnapshot?.();
    }
    input.remove();
    label.style.visibility = 'visible';
    redrawEdges();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    // Alt+Enter 在编辑中：保存并立即执行
    else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); commit(true); runEdge(edge.id); }
  });
  input.addEventListener('blur', () => commit(true));
}

// =========================================================================
