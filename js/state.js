// =========================================================================
// state.js —— 全局状态与常量（唯一的状态中心）
// 所有模块从这里 import 共享状态。
// =========================================================================

export const PREFIX = '🖐️';
export const API_URL = 'https://api.deepseek.com/chat/completions';

// 区域调色板（每个新区域依次取色）
export const ZONE_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899'];

// ---- 可变的 id 计数器 ----
// 用对象包裹，保证所有模块读到/写到的都是同一个引用
export const seq = { node: 0, edge: 0, zone: 0, task: 0 };

// ---- 主状态 ----
export const state = {
  nodes: {},   // id -> { id, kind, title, x, y, w, h, text, src, prompt, zoneId, el }
  edges: {},   // id -> { id, source, target, command, labelEl }
  zones: {},   // id -> { id, title, x, y, w, h, color, level, el }
  selectedEdgeId: null,
  filterZoneId: 'all',   // 层级过滤：'all' 或某个 zoneId
  tasks: {},             // id -> { id, name, edgeIds: [] }
  activeTaskId: null,
  olTab: 'outline',      // 左侧当前 Tab: 'outline' | 'tasks'
};

// ---- 视口（缩放 / 平移）----
export const view = { x: 0, y: 0, scale: 1 };

// ---- 拖拽连线时的临时预览 { source, x1, y1, x2, y2 } ----
export const linkState = { pending: null };

// =========================================================================
// 调试工具
// =========================================================================
export const DBG = {
  enabled: true,
  lastRequest: null,
  on()  { this.enabled = true;  console.log('[DBG] 调试已开启'); },
  off() { this.enabled = false; console.log('[DBG] 调试已关闭'); },
  log(...a)  { if (this.enabled) console.log('%c[DBG]', 'color:#4f46e5;font-weight:bold', ...a); },
  warn(...a) { if (this.enabled) console.warn('%c[DBG]', 'color:#d97706;font-weight:bold', ...a); },
  err(...a)  { console.error('%c[DBG]', 'color:#dc2626;font-weight:bold', ...a); },
};

// 暴露到全局，方便控制台调试
if (typeof window !== 'undefined') {
  window.DBG = DBG;
  window.state = state;
  window.view = view;
}

// ---- 通用小工具 ----
export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 轻提示
let toastTimer = null;
export function flashToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
