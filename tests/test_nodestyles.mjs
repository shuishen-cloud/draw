// =========================================================================
// test_nodestyles.mjs —— 卡片配色纯逻辑（node --test，无需浏览器）
//   node --test tests/test_nodestyles.mjs
// =========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE_COLORS, hasCustomColor, nextColor, normalizeColor } from '../js/nodestyles.js';

test('调色板有 7 个颜色且不含重复', () => {
  assert.equal(NODE_COLORS.length, 7);
  assert.equal(new Set(NODE_COLORS).size, 7);
});

test('合法 key 原样保留', () => {
  for (const c of NODE_COLORS) assert.equal(normalizeColor(c), c);
});

test('大小写与空白被规整', () => {
  assert.equal(normalizeColor('  RED '), 'red');
  assert.equal(normalizeColor('Blue'), 'blue');
});

test('null / undefined / 空串都表示「跟随默认色」', () => {
  assert.equal(normalizeColor(null), null);
  assert.equal(normalizeColor(undefined), null);
  assert.equal(normalizeColor(''), null);
  assert.equal(normalizeColor('   '), null);
});

test('非法值回退 null 且不抛错（旧画布兼容的关键）', () => {
  for (const bad of ['pink', 'reddish', '#ff0000', 123, true, {}, [], NaN]) {
    assert.equal(normalizeColor(bad), null, String(bad));
  }
});

test('hasCustomColor 区分「有自定义色」与「跟随默认」', () => {
  assert.equal(hasCustomColor('blue'), true);
  assert.equal(hasCustomColor(null), false);
  assert.equal(hasCustomColor('pink'), false);
});

test('nextColor 从默认色开始给第一个颜色', () => {
  assert.equal(nextColor(null), NODE_COLORS[0]);
  assert.equal(nextColor('pink'), NODE_COLORS[0]);
});

test('nextColor 循环切换且不会越界', () => {
  assert.equal(nextColor('red'), 'orange');
  assert.equal(nextColor(NODE_COLORS[NODE_COLORS.length - 1]), NODE_COLORS[0]);
});

test('反复调用 nextColor 能遍历全部颜色后回到起点', () => {
  let c = null;
  const seen = [];
  for (let i = 0; i < NODE_COLORS.length; i++) { c = nextColor(c); seen.push(c); }
  assert.deepEqual(seen, NODE_COLORS);
  assert.equal(nextColor(c), NODE_COLORS[0]);
});
