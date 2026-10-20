import { DBG, PREFIX, flashToast, state } from './state.js';
import { redrawEdges } from './edges.js';
import { runEdge, streamLLM } from './exec.js';
import { removeEdge } from './nodes.js';
import { depthOf, topoSortEdges } from './tasks.js';
// 11. 全局运行 / 快捷键
// =========================================================================

// 进度状态（瞬态，不持久化）：null 表示未在运行
state.runProgress = null;

// 按节点 id 运行：执行节点跑自身；其它节点找它出发的连线来跑（取第一条可执行的）
export function runNodeById(nodeId) {
  const node = state.nodes[nodeId];
  if (!node) { DBG.warn('runNodeById: 节点不存在', nodeId); return; }
  if (node.kind === 'exec') return runExecNode(nodeId);

  // 从该节点出发、且命令可执行的连线
  const out = Object.values(state.edges).filter(e =>
    e.source === nodeId && e.command.trim().startsWith(PREFIX));
  if (!out.length) {
    DBG.warn('节点没有可执行的下游连线', nodeId);
    flashToast('这个节点没有可执行的下游连线（命令需以 🖐️ 开头）');
    return;
  }
  return runEdge(out[0].id);
}

// 运行当前选中：优先选中连线，其次选中的执行节点
// 平板上的主入口（工具栏「▶ 运行选中」）；桌面仍可用 Alt+Enter
export function runSelection() {
  if (state.selectedEdgeId && state.edges[state.selectedEdgeId]) {
    return runEdge(state.selectedEdgeId);
  }
  const sel = Object.values(state.nodes).find(n => n.el?.classList.contains('selected'));
  if (sel) return runNodeById(sel.id);
  flashToast('先点选一条连线或一个节点');
  return Promise.resolve();
}

// 更新运行状态（节点脉冲 + 进度按钮）
function setRunning(nodeId, on) {
  const n = state.nodes[nodeId];
  n?.el?.classList.toggle('running', on);
}
function setProgress(info) {
  state.runProgress = info;
  const btn = document.getElementById('runAll');
  if (!btn) return;
  if (!info) {
    btn.textContent = '全部运行 ▶';
    btn.classList.remove('running');
    return;
  }
  btn.textContent = `运行中 ${info.done}/${info.total} ✕`;
  btn.classList.add('running');
}

// 重执行节点：聚合所有上游节点的内容，按节点内提示词处理
export async function runExecNode(nodeId) {
  const node = state.nodes[nodeId];
  if (!node || node.kind !== 'exec') { DBG.warn('非执行节点', nodeId); return; }

  const promptText = (node.prompt || '').trim();
  if (!promptText) {
    alert('执行节点还没有填写提示词（双击标题可运行）');
    return;
  }

  // 收集所有指向本节点的入边（多输入聚合）
  const incoming = Object.values(state.edges).filter(e => e.target === nodeId);
  DBG.log('========== runExecNode', nodeId, '入边数 =', incoming.length, '==========');
  if (!incoming.length) {
    DBG.warn('没有任何输入连线');
    alert('该执行节点还没有上游连线');
    return;
  }

  const parts = [];
  const images = [];
  incoming.forEach((e, i) => {
    const src = state.nodes[e.source];
    if (!src) return;
    const fromLabel = 'N' + (Object.keys(state.nodes).indexOf(e.source) + 1);
    if (src.kind === 'img' && src.src) {
      images.push(src.src);
      parts.push(`【输入${i + 1} · 来自 ${fromLabel}】[图片]`);
    } else {
      parts.push(`【输入${i + 1} · 来自 ${fromLabel}】\n${src.text || '（空）'}`);
    }
  });
  const merged = parts.join('\n\n');
  DBG.log('聚合输入长度 =', merged.length, '| 图片数 =', images.length);

  const key = document.getElementById('apiKey').value.trim()
    || localStorage.getItem('deepseek_key') || '';
  if (!key) { alert('请先填写 DeepSeek API Key'); return; }

  // 清空结果并显示进行中
  node.text = '';
  node.textEl.textContent = '思考中…';
  node.textEl.classList.remove('empty');

  const out = await streamLLM({
    key, promptText, doc: merged, images,
    onDelta: (t) => { node.text = t; node.textEl.textContent = t; },
  });
  node.text = out;
  DBG.log('========== runExecNode', nodeId, '完成，输出', out.length, '字 ==========');
}

// 全部运行：支持进度上报与取消（signal.aborted）
//   opts.onProgress({done, total, kind, id})
//   opts.signal = { aborted: boolean }  —— 外部置 true 即停止后续项
export async function runAll(opts = {}) {
  const signal = opts.signal || { aborted: false };
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  // 按拓扑依赖顺序运行所有连线，保证链式（如 exec A → exec B）顺序正确
  const ordered = topoSortEdges(Object.keys(state.edges));
  const execs = Object.values(state.nodes).filter(n => n.kind === 'exec')
    .sort((a, b) => depthOf(a.id) - depthOf(b.id));
  const total = ordered.length + execs.length;
  DBG.log('全部运行：连线', ordered.length, '条，执行节点', execs.length, '个（已按依赖排序）');
  let done = 0;

  const step = (edge) => {
    done++;
    setProgress({ done, total, kind: edge ? 'edge' : 'exec' });
    onProgress?.({ done, total, kind: edge ? 'edge' : 'exec',
                   id: edge ? edge.id : null });
  };

  try {
    for (const e of ordered) {
      if (signal.aborted) break;
      step(e);
      setRunning(e.target, true);
      try { await runEdge(e.id); } finally { setRunning(e.target, false); }
    }
    // 最后按拓扑顺序跑执行节点（汇总上游结果）
    if (!signal.aborted) {
      for (const n of execs) {
        if (signal.aborted) break;
        step(null);
        setRunning(n.id, true);
        try { await runExecNode(n.id); } finally { setRunning(n.id, false); }
      }
    }
  } finally {
    setProgress(null);
    // 清理残留的运行标记（取消时可能留下）
    Object.values(state.nodes).forEach(n => n.el?.classList.remove('running'));
  }
  if (signal.aborted) DBG.log('运行已取消，已完成', done, '/', total);
  else DBG.log('全部运行结束：', done, '/', total);
}

// Alt+Enter：优先运行选中/悬停的连线；否则若选中执行节点则运行它
export function runCurrentEdge() {
  let id = state.selectedEdgeId;
  if (!id) {
    const hovered = document.querySelectorAll('#edges .wire:hover');
    if (hovered.length) id = hovered[0].dataset.edge;
  }
  if (id) { runEdge(id); return; }

  // 没有选中连线：看看有没有选中的执行节点
  const sel = Object.values(state.nodes).find(n => n.el.classList.contains('selected'));
  if (sel && sel.kind === 'exec') { runExecNode(sel.id); return; }
  DBG.warn('没有选中/悬停任何连线或执行节点');
}

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'Enter') {
    e.preventDefault();
    runCurrentEdge();
  }
  // Delete 删除选中连线
  if ((e.key === 'Delete' || e.key === 'Backspace')
      && state.selectedEdgeId
      && document.activeElement === document.body) {
    removeEdge(state.selectedEdgeId);
    redrawEdges();
    window.scheduleSnapshot?.();
  }
});

// =========================================================================
