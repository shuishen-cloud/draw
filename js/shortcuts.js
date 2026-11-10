// =========================================================================
// shortcuts.js —— 画布类快捷键（桌面端为主，触摸端不受影响）
//
// 设计约束（见 doc/feat/ui-polish.md §2.4）：
//   1. 只在「不在输入框 / 不在就地编辑」时生效，否则一律放行；
//   2. 不与既有绑定冲突：空格平移、Esc 框选/浮层关闭各自在 main.js，
//      这里只在「没有别的事情占用 Esc」时取消选中；
//   3. 所有动作都走既有导出函数（removeNode / selectNode / zoomAt …），
//      不新增数据字段，因此不影响保存/导出格式。
// =========================================================================
import { DBG, HOST, state, view } from './state.js';
import { layoutNode, removeEdge, removeNode, selectNode } from './nodes.js';
import { redrawEdges } from './edges.js';
import { canvasEl, centerContent, fitToContent, zoomAt } from './viewport.js';

// 焦点在可编辑元素里时，快捷键必须让位（否则 Backspace 会删节点）
function inEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return !!target.closest?.('[contenteditable="true"]');
}

// 可见区中心（缩放锚点，与 main.js 的 viewCenter 一致）
function visibleCenter() {
  const wrap = document.getElementById('canvasWrap') || canvasEl();
  const r = wrap.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// 取消所有选中（节点 + 连线）
function clearSelection() {
  selectNode(null);
  if (state.selectedEdgeId) {
    state.selectedEdgeId = null;
    redrawEdges();
  }
}

// 方向键微移选中节点；Shift 加速到 10px
function nudge(dx, dy) {
  const node = state.nodes[state.selectedNodeId];
  if (!node) return false;
  node.x += dx;
  node.y += dy;
  layoutNode(node);
  redrawEdges();
  HOST.scheduleSnapshot?.();
  return true;
}

export function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    // 输入中 / 就地编辑中：全部放行
    if (inEditable(e.target)) return;
    // 正在编辑连线命令（输入框在 #world 内，但保险起见再判一次）
    if (document.querySelector('.edge-input')) return;

    const mod = e.ctrlKey || e.metaKey;

    // ---- 缩放 ----
    if (mod && (e.key === '0')) {
      e.preventDefault();
      view.scale = 1;
      centerContent();
      DBG.log('快捷键', 'Ctrl+0 回到 100%');
      return;
    }
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const c = visibleCenter();
      zoomAt(c.x, c.y, 1.2);
      DBG.log('快捷键', '放大');
      return;
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      const c = visibleCenter();
      zoomAt(c.x, c.y, 1 / 1.2);
      DBG.log('快捷键', '缩小');
      return;
    }

    // 带修饰键的其余组合交给浏览器（Ctrl+C/V 等）
    if (mod || e.altKey) return;

    // ---- 取消选中 ----
    if (e.key === 'Escape') {
      if (state.selectedNodeId || state.selectedEdgeId) {
        e.preventDefault();
        clearSelection();
        DBG.log('快捷键', 'Esc 取消选中');
      }
      return;
    }

    // ---- 删除 ----
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedNodeId && state.nodes[state.selectedNodeId]) {
        e.preventDefault();
        const id = state.selectedNodeId;
        removeNode(id);
        selectNode(null);
        HOST.scheduleSnapshot?.();
        DBG.log('快捷键', 'Delete 删除节点', id);
        return;
      }
      if (state.selectedEdgeId && state.edges[state.selectedEdgeId]) {
        e.preventDefault();
        const id = state.selectedEdgeId;
        removeEdge(id);
        state.selectedEdgeId = null;
        redrawEdges();
        HOST.scheduleSnapshot?.();
        DBG.log('快捷键', 'Delete 删除连线', id);
        return;
      }
      return;
    }

    // ---- 方向键微移 ----
    const step = e.shiftKey ? 10 : 1;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      if (state.selectedNodeId) {
        e.preventDefault();
        nudge(...moves[e.key]);
        DBG.log('快捷键', '微移', e.key, step);
      }
      return;
    }

    // ---- 视图：F 适应内容 ----
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      fitToContent();
      DBG.log('快捷键', 'F 适应内容');
    }
  });
}
