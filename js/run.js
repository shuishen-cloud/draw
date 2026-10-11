import { DBG, state } from './state.js';
import { redrawEdges } from './edges.js';
import { runEdge, streamLLM } from './exec.js';
import { removeEdge } from './nodes.js';
import { depthOf, topoSortEdges } from './tasks.js';
// 11. 全局运行 / 快捷键
// =========================================================================
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

export async function runAll() {
  // 按拓扑依赖顺序运行所有连线，保证链式（如 exec A → exec B）顺序正确
  const ordered = topoSortEdges(Object.keys(state.edges));
  const execs = Object.values(state.nodes).filter(n => n.kind === 'exec')
    .sort((a, b) => depthOf(a.id) - depthOf(b.id));
  DBG.log('全部运行：连线', ordered.length, '条，执行节点', execs.length, '个（已按依赖排序）');
  for (const e of ordered) await runEdge(e.id);
  // 最后按拓扑顺序跑执行节点（汇总上游结果）
  for (const n of execs) await runExecNode(n.id);
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
