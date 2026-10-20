import { DBG, PREFIX, escapeHtml, linkState, seq, state, view } from './state.js';
import { runEdge } from './exec.js';
import { drawMiniMap } from './minimap.js';
import { applyFilter } from './outline.js';
import { toggleEdgeInTask } from './tasks.js';
import { screenToWorld, worldEl } from './viewport.js';
import {
  anchorSide, edgeEndpoints, bezierPath, hitTest, nearestBorderPoint,
} from './geom.js';
// 6. 连线：任意节点、任意锚点拖出
// =========================================================================
const DRAG_THRESHOLD = 8;   // 屏幕像素；超过才认为是「拖出连线」而非点击/拖节点

// 命中容差：屏幕上约 12px，换算到 world 才能与缩放无关
export function hitTolerance() {
  return 12 / (view.scale || 1);
}

// 端口的 pointerdown：先按兵不动，拖出阈值后才真正开始连线
export function bindLinkHandle(node, el) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    function onMove(ev) {
      if (started) return;
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      started = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      startLinkFrom(node, ev);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    }
    function onCancel() { onUp(); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  });
}

// 从节点上任意位置开始拉线；fromPoint 为 pointerdown 的屏幕坐标
// （也可由 pointermove 触发，此时按 ev 当前点定锚点）
export function startLinkFrom(node, e) {
  const p0 = screenToWorld(e.clientX, e.clientY);
  // 起点锚在节点「最近的那条边」上：手指按在哪侧就从哪侧出发
  const anchor = nearestBorderPoint(node, p0.x, p0.y);
  linkState.pending = {
    source: node.id,
    x1: anchor.x, y1: anchor.y,
    x2: p0.x, y2: p0.y,
    targetId: null,
  };
  DBG.log('起连', node.id, '锚点', Math.round(anchor.x), Math.round(anchor.y));
  drawGhost(linkState.pending);

  const list = () => Object.values(state.nodes)
    .filter(n => n.id !== node.id)
    .map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));

  function onMove(ev) {
    const pending = linkState.pending;
    if (!pending || pending.source !== node.id) return;
    const q = screenToWorld(ev.clientX, ev.clientY);
    pending.x2 = q.x;
    pending.y2 = q.y;
    // 实时高亮候选目标（落在边框带内即算）
    const hitId = hitTest(list(), q.x, q.y, hitTolerance());
    if (hitId !== pending.targetId) {
      clearLinkHighlight();
      if (hitId) {
        state.nodes[hitId]?.el.classList.add('link-target');
        DBG.log('候选目标', hitId);
      }
      pending.targetId = hitId;
    }
    drawGhost(pending);
  }

  function onUp(ev) {
    cleanup();
    const pending = linkState.pending;
    linkState.pending = null;
    drawGhost(null);
    clearLinkHighlight();
    if (!pending) return;
    const q = screenToWorld(ev.clientX, ev.clientY);
    // 松手位置重新判定一次（move 可能没跟上最后一帧）
    const hitId = hitTest(list(), q.x, q.y, hitTolerance());
    if (!hitId) { DBG.log('连线取消：落在空白'); return; }
    if (hitId === node.id) { DBG.log('连线取消：落在自身'); return; }
    addEdge(node.id, hitId);
    DBG.log('建边', node.id, '->', hitId);
  }

  function onCancel() {
    cleanup();
    linkState.pending = null;
    drawGhost(null);
    clearLinkHighlight();
    DBG.log('连线取消：pointercancel');
  }

  function cleanup() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
}

// 清掉所有节点的候选高亮
export function clearLinkHighlight() {
  document.querySelectorAll('.node.link-target')
    .forEach(el => el.classList.remove('link-target'));
}

export function finishLinkTo(node) {
  // 由 startLinkFrom 的 pointerup 统一处理（按坐标命中判定）
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
  // 两端都取「朝向对方那条边」的中点，线永远连在边上（world 坐标）
  const g = edgeEndpoints(a, b);
  g.from = anchorSide(a, g.x1, g.y1);
  g.to = anchorSide(b, g.x2, g.y2);
  return g;
}

// 连线路径（对外接口名保持 edgePath，内部走 geom.bezierPath）
export function edgePath(g) {
  return bezierPath(g);
}

// 增量渲染：复用已有 DOM，只更新 d 与 class。
// 这样 running 的流动动画不会因为重绘被打断。
export function redrawEdges() {
  const svg = document.getElementById('edges');
  const seen = new Set();
  for (const edge of Object.values(state.edges)) {
    const g = edgeGeometry(edge);
    if (!g) continue;
    seen.add(edge.id);
    let p = edge.pathEl;
    if (!p || !p.isConnected) {
      p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.dataset.edge = edge.id;
      p.addEventListener('click', () => selectEdge(edge.id));
      p.addEventListener('dblclick', () => editEdgeLabel(edge));
      svg.appendChild(p);
      edge.pathEl = p;
    }
    const executable = edge.command.trim().startsWith(PREFIX);
    p.setAttribute('d', edgePath(g));
    p.setAttribute('class', 'wire'
      + (executable ? ' executable' : '')
      + (state.selectedEdgeId === edge.id ? ' selected' : '')
      + (edge.running ? ' running' : '')          // 动画只靠 class 驱动
      + (edge.flash ? ' flash-' + edge.flash : ''));
    layoutEdgeLabel(edge);
  }
  // 移除已删除的边
  for (const p of svg.querySelectorAll('path.wire')) {
    if (!seen.has(p.dataset.edge)) p.remove();
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
    ghost.setAttribute('pointer-events', 'none');
    svg.appendChild(ghost);
  }
  // 预览线：起点在源节点锚点，终点跟随手指
  ghost.setAttribute('d', bezierPath({
    x1: link.x1, y1: link.y1, x2: link.x2, y2: link.y2,
    from: 'auto', to: 'auto',
  }));
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
