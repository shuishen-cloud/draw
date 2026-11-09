// =========================================================================
// canvases.js —— 多画布仓库（本地多份画布的新建 / 切换 / 重命名 / 复制 / 删除）
//
// 存储布局（见 doc/feat/multi-canvas.md）：
//   mc_canvases        -> [{ id, name, updatedAt }]     清单（只有元数据）
//   mc_canvas:<id>     -> exportCanvasData() 的 JSON    单画布正文
//   mc_active          -> 当前画布 id
//   mc_canvas（旧版）   -> 仅用于一次性迁移，迁移后保留不删
//
// 只把「清单」和「正文」拆开存，切换器才能只读一个小数组，
// 不必把所有画布（可能含 base64 大图）反序列化。
// =========================================================================
import { DBG } from './state.js';
import { exportCanvasData, importCanvasData, clearCanvas } from './io2.js';

export const KEY_LIST = 'mc_canvases';
export const KEY_ACTIVE = 'mc_active';
export const LEGACY_KEY = 'mc_canvas';
export const keyOf = (id) => 'mc_canvas:' + id;

// ---- 存储注入（测试用内存版，浏览器用 localStorage）----
function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
let storage = defaultStorage();
export function __setStorage(s) { storage = s || defaultStorage(); }

function readJSON(key, fallback) {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    DBG.warn('读取本地数据失败：', key, e.message);
    return fallback;
  }
}

function writeJSON(key, val) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(val));
    return true;
  } catch (e) {
    // 通常是图片太大超出 localStorage 限额：只告警，不影响继续编辑
    DBG.warn('写入本地数据失败（可能图片太大）：', key, e.message);
    return false;
  }
}

// 生成不重复的短 id
function newId() {
  const list = readJSON(KEY_LIST, []);
  let n = list.length + 1;
  const used = new Set(list.map(c => c.id));
  let id;
  do { id = 'c' + n++; } while (used.has(id));
  return id;
}

function writeList(list) { return writeJSON(KEY_LIST, list); }

const EMPTY_CANVAS = { format: 'mutiplechat-canvas', version: 1,
  view: { x: 0, y: 0, scale: 1 }, nodes: [], edges: [], zones: [], tasks: [] };

// 清单丢失但正文键还在时，找回一个可复用的 id（避免把真数据当空白覆盖掉）
function findOrphanBody() {
  if (!storage) return null;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('mc_canvas:') && storage.getItem(k)) {
        return k.slice('mc_canvas:'.length);
      }
    }
  } catch (e) { DBG.warn('扫描本地画布失败：', e.message); }
  return null;
}

// ---- 查询 ----
export function listCanvases() {
  const list = readJSON(KEY_LIST, []);
  return Array.isArray(list) ? list : [];
}

export function activeCanvasId() {
  if (!storage) return null;
  return storage.getItem(KEY_ACTIVE);
}

function touch(id) {
  const list = listCanvases();
  const item = list.find(c => c.id === id);
  if (!item) return false;
  item.updatedAt = new Date().toISOString();
  return writeList(list);
}

// 把当前内存画布立即写回「当前 id」的键（同步，绕过自动保存防抖）
export function saveCurrent() {
  const id = activeCanvasId();
  if (!id) return false;
  return writeJSON(keyOf(id), exportCanvasData());
}

// 载入某张画布；正文缺失/损坏时清空成空画布，不抛错
function loadInto(id) {
  const raw = storage ? storage.getItem(keyOf(id)) : null;
  if (raw) {
    try {
      importCanvasData(JSON.parse(raw));
      return true;
    } catch (e) {
      DBG.warn('画布正文损坏，已按空画布打开：', id, e.message);
    }
  }
  clearCanvas();
  return false;
}

// ---- 迁移 & 保证仓库可用 ----
// 幂等：重复调用不会新增画布，也不会覆盖已有正文
export function ensureRepo() {
  if (!storage) return null;

  let list = listCanvases();
  if (!Array.isArray(list) || list.length === 0) {
    // 旧版单画布数据 → 迁移成第一张「默认画布」（保留旧键，避免迁移出错时丢图）
    const legacy = storage.getItem(LEGACY_KEY);
    // 清单丢了但正文键还在（极端情况）：优先认领已有正文，避免覆盖掉真数据
    const orphan = findOrphanBody();
    const id = orphan || newId();
    list = [{ id, name: legacy ? '默认画布' : '画布 1', updatedAt: new Date().toISOString() }];
    writeList(list);
    if (legacy) {
      try { storage.setItem(keyOf(id), legacy); }
      catch (e) { DBG.warn('旧画布迁移失败（可能超限）：', e.message); }
      DBG.log('已把旧版画布迁移为「默认画布」');
    } else if (!orphan) {
      // 全新用户：清单有了正文也得有，否则 refresh/切换读到 null
      try { storage.setItem(keyOf(id), JSON.stringify(EMPTY_CANVAS)); }
      catch (e) { DBG.warn('初始化空画布失败：', e.message); }
    }
  }

  // active 指向的画布必须存在
  const cur = activeCanvasId();
  if (!cur || !list.some(c => c.id === cur)) {
    writeActive(list[0].id);
  }
  return activeCanvasId();
}

function writeActive(id) {
  if (!storage) return;
  try { storage.setItem(KEY_ACTIVE, id); }
  catch (e) { DBG.warn('保存当前画布 id 失败：', e.message); }
}

// ---- 变更操作 ----
export function switchCanvas(id) {
  ensureRepo();
  if (!listCanvases().some(c => c.id === id)) return false;
  if (id === activeCanvasId()) return true;

  saveCurrent();          // 先落盘，避免切换瞬间的编辑丢失
  writeActive(id);
  loadInto(id);
  DBG.log('已切换画布：', id);
  return true;
}

export function createCanvas(name) {
  ensureRepo();
  saveCurrent();          // 旧画布先落盘
  const list = listCanvases();
  const id = newId();
  list.push({ id, name: name || ('画布 ' + (list.length + 1)), updatedAt: new Date().toISOString() });
  writeList(list);
  writeActive(id);
  clearCanvas();          // 新画布从空白开始
  saveCurrent();          // 立刻把空白正文写盘（防抖保存可能来不及）
  DBG.log('已新建画布：', id);
  return id;
}

export function renameCanvas(id, name) {
  const list = listCanvases();
  const item = list.find(c => c.id === id);
  if (!item) return false;
  item.name = String(name || '').trim() || item.name;
  item.updatedAt = new Date().toISOString();
  writeList(list);
  DBG.log('画布已重命名：', id, '->', item.name);
  return true;
}

export function duplicateCanvas(id, name) {
  ensureRepo();
  const list = listCanvases();
  const src = list.find(c => c.id === id);
  if (!src) return null;

  if (id === activeCanvasId()) saveCurrent();   // 保证拷贝的是最新内容
  const body = storage ? storage.getItem(keyOf(id)) : null;

  const nid = newId();
  const nname = name || (src.name + ' 副本');
  list.push({ id: nid, name: nname, updatedAt: new Date().toISOString() });
  writeList(list);
  if (body) {
    try { storage.setItem(keyOf(nid), body); }
    catch (e) { DBG.warn('复制画布正文失败（可能超限）：', e.message); }
  }
  DBG.log('已复制画布：', id, '->', nid);
  return nid;
}

export function removeCanvas(id) {
  const list = listCanvases();
  const i = list.findIndex(c => c.id === id);
  if (i < 0) return false;

  list.splice(i, 1);
  try { storage && storage.removeItem(keyOf(id)); }
  catch (e) { DBG.warn('删除画布正文失败：', e.message); }

  // 永远至少保留一张画布
  if (list.length === 0) {
    const nid = newId();
    list.push({ id: nid, name: '画布 1', updatedAt: new Date().toISOString() });
    writeList(list);
    writeActive(nid);
    clearCanvas();
    saveCurrent();         // 空画布也要落盘，否则切回时读到 null
    DBG.log('已删除最后一张画布，已自动新建空画布');
    return true;
  }

  writeList(list);
  if (activeCanvasId() === id) {
    writeActive(list[0].id);
    loadInto(list[0].id);
  }
  DBG.log('已删除画布：', id);
  return true;
}
