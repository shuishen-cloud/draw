// =========================================================================
// floating.js —— 可拖拽悬浮面板（大纲 / 对话 / 工具栏）
//
// 目标：实现尽量简单。三块能力：
//   1. bindFloatingPanel(el, { handle, key, foldBtn })
//        拖 handle 移动面板；松手夹紧到视口内；位置存 localStorage。
//   2. bindFab(fab, panel)   悬浮球开/关工具栏（折叠态也持久化）。
//   3. bindToolbar()         = bindFab + bindFloatingPanel(工具栏)
//
// 约定（与 styles.css 一致）：
//   · 面板是 #canvasWrap 内的 absolute 元素，用 left/top 定位；
//   · el.collapsed 表示「只留头部」，不改变 left/top，因此折叠后仍可拖；
//   · 拖拽只认 handle 上的手指/鼠标，handle 里的按钮不触发拖动。
// =========================================================================
import { DBG } from './state.js';

const LS_FLOATING = 'mc.floating';
const LS_TOOLBAR_FOLDED = 'mc.toolbarCollapsed';

// localStorage 读写包一层：隐私模式 / 配额满时静默降级到默认位置
function readFloating() {
  try { return JSON.parse(localStorage.getItem(LS_FLOATING) || '{}') || {}; } catch { return {}; }
}
function writeFloating(pos) {
  try { localStorage.setItem(LS_FLOATING, JSON.stringify(pos)); } catch {}
}

/**
 * 让面板可拖拽 + 位置持久化。
 * @param {HTMLElement} el      面板根元素
 * @param {object} opts
 * @param {HTMLElement} opts.handle  拖拽把手（通常是面板头部）
 * @param {string}  opts.key     持久化用的键名（outline / sidebar / toolbar）
 * @param {HTMLElement} [opts.foldBtn] 折叠按钮
 */
export function bindFloatingPanel(el, { handle, key, foldBtn } = {}) {
  if (!el) return;
  const wrap = el.parentElement || document.getElementById('canvasWrap');

  // ---- 恢复上次位置 ----
  const saved = readFloating()[key];
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    el.style.left = saved.x + 'px';
    el.style.top = saved.y + 'px';
  }

  // 夹紧：保证面板至少有 80×40 落在 #canvasWrap 可见区内。
  // 顶层至少留 44px 高（约等于一行标题栏），否则折叠后头部也可能被拖没。
  const clamp = () => {
    const box = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const minVisibleX = 80, minVisibleY = 44;
    const maxLeft = box.width - minVisibleX;
    const maxTop = box.height - minVisibleY;
    const left = Math.min(Math.max(-r.width + minVisibleX, r.left - box.left), maxLeft);
    const top = Math.min(Math.max(0, r.top - box.top), maxTop);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  };

  // ---- 拖拽 ----
  let drag = null;
  const onDown = (e) => {
    // 只认主键 / 单指；把手上的按钮不算拖拽起手
    if (e.button !== undefined && e.button !== 0) return;
    // 把手上的按钮不算拖拽起手（Tab 可以拖：只有没拖动时 click 才切视图）
    if (e.target.closest('button, input, select')) return;
    const box = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, boxLeft: box.left, boxTop: box.top };
    el.classList.add('dragging');
    // 捕获指针：拖动时手指移出面板也照样收到 move
    try { handle.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!drag) return;
    const box = wrap.getBoundingClientRect();
    // 允许拖出一点点（clamp 在松手时统一收），拖动过程只跟随手指
    el.style.left = Math.round(e.clientX - drag.dx - box.left) + 'px';
    el.style.top = Math.round(e.clientY - drag.dy - box.top) + 'px';
  };

  const onUp = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    clamp();
    const pos = readFloating();
    pos[key] = { x: parseInt(el.style.left, 10) || 0, y: parseInt(el.style.top, 10) || 0 };
    writeFloating(pos);
    DBG.log('浮窗拖动', key, pos[key]);
  };


  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);

  // 只有头部把面板提到最前：内容区里可能开着弹出层（#canvasPanel 贴着
  // 画布按钮），任何点击都抬 z-index 会把它盖住。
  handle.addEventListener('pointerdown', () => bringToFront(el), true);

  // ---- 折叠 ----
  if (foldBtn) {
    foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.toggle('collapsed');
      DBG.log('浮窗折叠', key, el.classList.contains('collapsed'));
    });
  }

  // 视口变化后重新夹紧（否则窗口变小时面板会永久留在屏幕外）
  window.addEventListener('resize', () => { clamp(); });

  // 首屏也夹一次：默认位置按 CSS 给，可能超出窄屏
  requestAnimationFrame(clamp);
}

/**
 * 把某个浮窗提到最前（点它时调用）。
 * 用递增的 inline z-index 实现，不做完整的层级管理 —— 三块面板够用。
 */
let topZ = 40;
export function bringToFront(el) {
  if (!el) return;
  el.style.zIndex = String(++topZ);
}

/** 悬浮球：开 / 关工具栏 */
export function bindFab(fab, panel) {
  if (!fab || !panel) return;
  const sync = () => {
    const folded = panel.classList.contains('folded');
    fab.classList.toggle('active', !folded);
    fab.setAttribute('aria-expanded', String(!folded));
  };
  fab.addEventListener('click', () => {
    panel.classList.toggle('folded');
    try { localStorage.setItem(LS_TOOLBAR_FOLDED, panel.classList.contains('folded') ? '1' : '0'); } catch {}
    DBG.log('工具栏折叠', panel.classList.contains('folded'));
    sync();
  });
  // 面板内的收起按钮
  document.getElementById('toolbarFold')?.addEventListener('click', () => fab.click());
  sync();
}

/** 工具栏：悬浮球 + 可拖拽 + 折叠态恢复 */
export function bindToolbar() {
  const panel = document.getElementById('toolbar');
  const fab = document.getElementById('toolbarFab');
  if (!panel || !fab) return;

  // 窄屏默认折叠：把屏幕还给画布；用户手动开过则以存储为准
  let saved = null;
  try { saved = localStorage.getItem(LS_TOOLBAR_FOLDED); } catch {}
  const narrow = window.matchMedia?.('(max-width: 1024px)').matches;
  const folded = saved === null ? !!narrow : saved === '1';
  panel.classList.toggle('folded', folded);

  bindFab(fab, panel);
  bindFloatingPanel(panel, { handle: panel.querySelector('.tb-head'), key: 'toolbar' });
}
