// =========================================================================
// store.js —— IndexedDB 薄封装（无第三方依赖）
//
// 为什么不用 localStorage：容量 5–10MB、setItem 同步阻塞主线程、
// 图片只能 base64（再膨胀 33%）。收藏是「低频、大块、只增不改」的数据，
// IndexedDB 更合适：容量数百 MB、异步、可直接存 Blob。
//
// 为什么不用 localForage/Dexie：项目零第三方依赖，且有离线单文件产物
// （build.js 手写拼接，无法打包 npm 包）。这里只做本项目需要的
// put/get/getAll/delete，不造通用 ORM、不自创 schema 惯例。
//
// 降级：IndexedDB 打不开（隐私模式 / 部分 file:// 环境）时回落到
// localStorage，此时会把 Blob 转成 dataURL 内联存储。
// =========================================================================
import { DBG, HOST } from './state.js';

export const DB_NAME = 'mc-fav';
export const DB_VERSION = 1;
export const STORE_ITEMS = 'items';
export const STORE_BLOBS = 'blobs';
const LS_ITEMS = 'mc_fav_items';

// ---- Blob <-> dataURL（降级路径需要）----
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('读取 Blob 失败'));
    fr.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  const isB64 = !!m[2];
  const data = isB64 ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i);
  return new Blob([arr], { type });
}

function idb() {
  return typeof indexedDB !== 'undefined' ? indexedDB : null;
}

// 打开数据库：建表 + 建索引；失败则抛错，由 openStore 决定是否降级
function openIDB() {
  return new Promise((resolve, reject) => {
    const factory = idb();
    if (!factory) return reject(new Error('IndexedDB 不可用'));

    let req;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(e);
    }

    // 某些环境（隐私模式）open 不回调，超时后主动失败，避免永久 pending
    const timer = setTimeout(() => reject(new Error('IndexedDB 打开超时')), 3000);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const s = db.createObjectStore(STORE_ITEMS, { keyPath: 'id' });
        s.createIndex('kind', 'kind', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('IndexedDB 打开失败')); };
    req.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB 被其他标签页占用')); };
    // 某些实现只会触发 error 而不带 req.error
    req.onabort = () => { clearTimeout(timer); reject(new Error('IndexedDB 打开被中止')); };
  });
}

// ---- IndexedDB 后端 ----
function idbBackend(db) {
  const tx = (name, mode) => db.transaction(name, mode).objectStore(name);

  const wrap = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
  });

  return {
    backend: 'idb',
    put(name, value) { return wrap(tx(name, 'readwrite').put(value)); },
    get(name, key) { return wrap(tx(name, 'readonly').get(key)); },
    getAll(name) { return wrap(tx(name, 'readonly').getAll()); },
    delete(name, key) { return wrap(tx(name, 'readwrite').delete(key)); },
    clear(name) { return wrap(tx(name, 'readwrite').clear()); },
    close() { try { db.close(); } catch { /* 忽略 */ } },
  };
}

// ---- localStorage 后端（降级）----
// 只有 items 一张表；图片在写入前已由上层转成 dataURL 内联在 data.src。
function lsBackend() {
  const read = () => {
    try {
      const raw = localStorage.getItem(LS_ITEMS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      DBG.warn('读取收藏列表失败：', e.message);
      return [];
    }
  };
  const write = (arr) => {
    try {
      localStorage.setItem(LS_ITEMS, JSON.stringify(arr));
      return true;
    } catch (e) {
      // 通常是图片太大超出限额：向上抛，让 UI 明确提示，不静默失败
      throw new Error('本地存储空间不足（图片太大）。请删除部分收藏或改用导出。');
    }
  };

  return {
    backend: 'local',
    async put(name, value) {
      if (name === STORE_BLOBS) return;          // 降级时不存在独立图片表
      const arr = read();
      const i = arr.findIndex(x => x.id === value.id);
      if (i >= 0) arr[i] = value; else arr.push(value);
      write(arr);
    },
    async get(name, key) {
      if (name === STORE_BLOBS) return undefined;
      return read().find(x => x.id === key);
    },
    async getAll(name) {
      if (name === STORE_BLOBS) return [];
      return read();
    },
    async delete(name, key) {
      if (name === STORE_BLOBS) return;
      write(read().filter(x => x.id !== key));
    },
    async clear(name) {
      if (name === STORE_BLOBS) return;
      write([]);
    },
    close() { /* 无连接可关 */ },
  };
}

let storePromise = null;

// 打开（并缓存）存储。IndexedDB 失败自动降级 localStorage。
export function openStore() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    try {
      const db = await openIDB();
      DBG.log('收藏存储：IndexedDB');
      return idbBackend(db);
    } catch (e) {
      DBG.warn('IndexedDB 不可用，降级到 localStorage：', e.message);
      HOST.__favBackendFallback = true;
      return lsBackend();
    }
  })();
  return storePromise;
}

// 重置（仅测试用：换上下文后需要重新探测后端）
export function __resetStore() {
  storePromise = null;
}

// 让上层在写图片时知道该用 Blob 还是 dataURL
export async function storeBackendName() {
  return (await openStore()).backend;
}

export { blobToDataURL, dataURLToBlob };
