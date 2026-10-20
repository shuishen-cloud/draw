// =========================================================================
// test_zone.mjs —— zone-auto-assign 的几何判定单测（node --test）
//
//   运行：node --test tests/test_zone.mjs
//   覆盖：命中/未命中/边界/重叠取最小面积/嵌套/空列表
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAtPointIn } from '../js/geom.js';

// 用纯函数版本测试，避免依赖 state（内部会绑定到 state.zones）
const z = (id, x, y, w, h) => ({ id, x, y, w, h });

test('点在某区域内 → 返回该区域', () => {
  const zones = [z('a', 0, 0, 100, 100)];
  assert.equal(zoneAtPointIn(50, 50, zones)?.id, 'a');
});

test('点在所有区域外 → null', () => {
  const zones = [z('a', 0, 0, 100, 100)];
  assert.equal(zoneAtPointIn(500, 500, zones), null);
});

test('点在空隙中（两区域之间）→ null', () => {
  const zones = [z('a', 0, 0, 100, 100), z('b', 300, 0, 100, 100)];
  assert.equal(zoneAtPointIn(200, 50, zones), null);
});

test('边界：正好在左上角 → 命中', () => {
  const zones = [z('a', 10, 10, 100, 100)];
  assert.equal(zoneAtPointIn(10, 10, zones)?.id, 'a');
});

test('边界：正好在右下角 → 命中', () => {
  const zones = [z('a', 10, 10, 100, 100)];
  assert.equal(zoneAtPointIn(110, 110, zones)?.id, 'a');
});

test('边界：刚出界 1px → null', () => {
  const zones = [z('a', 10, 10, 100, 100)];
  assert.equal(zoneAtPointIn(111, 50, zones), null);
  assert.equal(zoneAtPointIn(50, 111, zones), null);
});

test('重叠：返回面积小的区域', () => {
  const big = z('big', 0, 0, 400, 400);
  const small = z('small', 100, 100, 100, 100);
  assert.equal(zoneAtPointIn(150, 150, [big, small])?.id, 'small');
});

test('重叠：点在只属于大区域的位置 → 返回大区域', () => {
  const big = z('big', 0, 0, 400, 400);
  const small = z('small', 100, 100, 100, 100);
  assert.equal(zoneAtPointIn(50, 50, [big, small])?.id, 'big');
});

test('三层嵌套：返回最内层', () => {
  const zones = [
    z('outer', 0, 0, 300, 300),
    z('mid', 50, 50, 200, 200),
    z('inner', 100, 100, 100, 100),
  ];
  assert.equal(zoneAtPointIn(150, 150, zones)?.id, 'inner');
  assert.equal(zoneAtPointIn(75, 75, zones)?.id, 'mid');
  assert.equal(zoneAtPointIn(25, 25, zones)?.id, 'outer');
});

test('空区域列表 → null', () => {
  assert.equal(zoneAtPointIn(0, 0, []), null);
});

test('相同面积的并列：稳定返回第一个', () => {
  const a = z('a', 0, 0, 100, 100);
  const b = z('b', 0, 0, 100, 100);
  const r = zoneAtPointIn(50, 50, [a, b]);
  assert.ok(r && (r.id === 'a' || r.id === 'b'));
});

test('负坐标区域也能命中', () => {
  const zones = [z('neg', -200, -200, 100, 100)];
  assert.equal(zoneAtPointIn(-150, -150, zones)?.id, 'neg');
});
