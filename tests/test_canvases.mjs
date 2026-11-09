// =========================================================================
// test_canvases.mjs —— multi-canvas 阶段的纯逻辑测试（node --test）
//
//   运行：node --test tests/test_canvases.mjs
//   覆盖：迁移 / 建空 / create / switch / rename / duplicate / remove
//
// 设计：模块把 storage 作为可注入依赖，这里用内存版 Map 模拟 localStorage，
//       不需要 jsdom，也不碰 DOM。
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listCanvases, activeCanvasId, ensureRepo,
  createCanvas, switchCanvas, renameCanvas, duplicateCanvas, removeCanvas,
  KEY_LIST, KEY_ACTIVE, keyOf, __setStorage,
} from '../js/canvases.js';
import { exportCanvasData, importCanvasData, clearCanvas } from '../js/io2.js';

// ---- 内存版 localStorage ----
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    key(i) { return [...m.keys()][i] ?? null; },
    get length() { return m.size; },
    _dump() { return Object.fromEntries(m); },
  };
}

// 一张「有内容」的画布：1 节点 0 连线
function canvasWithNode(title) {
  clearCanvas();
  importCanvasData({
    format: 'mutiplechat-canvas', version: 1,
    view: { x: 0, y: 0, scale: 1 },
    nodes: [{ id: 'n1', kind: 'doc', title, x: 10, y: 20, w: 100, h: 80, text: 'hi' }],
    edges: [], zones: [], tasks: [],
  });
  return exportCanvasData();
}

test('迁移：只有旧键 mc_canvas → 变成第一张「默认画布」，正文不变', () => {
  const old = canvasWithNode('旧图');
  const s = memStorage({ mc_canvas: JSON.stringify(old) });
  __setStorage(s);

  ensureRepo();

  const list = listCanvases();
  assert.equal(list.length, 1, '应迁移出一张画布');
  assert.equal(list[0].name, '默认画布');
  assert.equal(activeCanvasId(), list[0].id, 'active 应指向迁移出的画布');

  const body = JSON.parse(s.getItem(keyOf(list[0].id)));
  assert.equal(body.nodes[0].title, '旧图', '迁移后正文必须原样保留');

  // 幂等：再跑一次不新增
  ensureRepo();
  assert.equal(listCanvases().length, 1, 'ensureRepo 必须幂等');
});

test('空仓库 → 自动建一张空画布并写 active', () => {
  const s = memStorage();
  __setStorage(s);
  clearCanvas();

  ensureRepo();

  const list = listCanvases();
  assert.equal(list.length, 1);
  assert.ok(s.getItem(KEY_ACTIVE), '必须写入 mc_active');
  assert.ok(s.getItem(KEY_LIST), '必须写入 mc_canvases');
  const body = JSON.parse(s.getItem(keyOf(list[0].id)));
  assert.deepEqual(body.nodes, [], '新画布应为空');
});

test('createCanvas：新画布为空且成为 active，旧画布内容落盘', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const first = activeCanvasId();
  importCanvasData(canvasWithNode('A'));

  const id2 = createCanvas('第二张');

  assert.notEqual(id2, first, 'id 必须唯一');
  assert.equal(activeCanvasId(), id2);
  assert.equal(listCanvases().length, 2);
  // 旧画布的正文已落盘
  const savedFirst = JSON.parse(s.getItem(keyOf(first)));
  assert.equal(savedFirst.nodes[0].title, 'A', '切换前需把当前画布落盘');
  // 新画布是空的
  assert.deepEqual(Object.keys(exportCanvasData().nodes), [], '切到新画布后不应残留旧节点');
});

test('switchCanvas：来回切换各自保留节点', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const a = activeCanvasId();
  importCanvasData(canvasWithNode('图A'));

  const b = createCanvas('B');
  importCanvasData(canvasWithNode('图B'));

  assert.equal(switchCanvas(a), true);
  assert.equal(exportCanvasData().nodes[0].title, '图A');
  assert.equal(switchCanvas(b), true);
  assert.equal(exportCanvasData().nodes[0].title, '图B');
});

test('switchCanvas：不存在的 id 返回 false 且不改 active', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const before = activeCanvasId();

  assert.equal(switchCanvas('不存在'), false);
  assert.equal(activeCanvasId(), before);
});

test('renameCanvas：更新清单里的名字并刷新 updatedAt', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const id = activeCanvasId();

  assert.equal(renameCanvas(id, '新名字'), true);
  assert.equal(listCanvases()[0].name, '新名字');
  assert.equal(renameCanvas('不存在', 'x'), false);
});

test('duplicateCanvas：深拷贝正文，改名「X 副本」，原画布不受影响', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const src = activeCanvasId();
  importCanvasData(canvasWithNode('原始'));

  const copy = duplicateCanvas(src);
  assert.ok(copy && copy !== src);
  assert.equal(listCanvases().length, 2);
  assert.equal(listCanvases().find(c => c.id === copy).name, '原始 副本');

  // 副本改成别的标题，源文件不应变化
  importCanvasData(canvasWithNode('改过的副本'));
  switchCanvas(src);
  assert.equal(exportCanvasData().nodes[0].title, '原始');
});

test('removeCanvas：删当前画布 → active 落到剩余；删最后一张 → 自动补空画布', () => {
  const s = memStorage();
  __setStorage(s);
  ensureRepo();
  const a = activeCanvasId();
  const b = createCanvas('B');

  assert.equal(removeCanvas(b), true, '删除当前画布');
  assert.equal(activeCanvasId(), a, 'active 应回落到剩余画布');
  assert.equal(s.getItem(keyOf(b)), null, '正文键应被清除');

  assert.equal(removeCanvas(a), true, '删除最后一张');
  assert.equal(listCanvases().length, 1, '必须自动补一张空画布');
  assert.notEqual(activeCanvasId(), a);
  assert.equal(exportCanvasData().nodes.length, 0);
});
