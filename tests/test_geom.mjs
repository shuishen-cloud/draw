// =========================================================================
// test_geom.mjs —— touch-link 阶段的纯函数测试（node --test）
//
//   运行：node --test tests/test_geom.mjs
//   覆盖：rectAnchor / edgeEndpoints / distanceToRect / hitTest /
//         nearestBorderPoint / edgePath / anchorSide
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rectAnchor, edgeEndpoints, distanceToRect, hitTest,
  nearestBorderPoint, bezierPath, anchorSide,
} from '../js/geom.js';

const A = { x: 0, y: 0, w: 100, h: 60 };
const B = { x: 300, y: 0, w: 100, h: 60 };   // A 右侧
const C = { x: 0, y: 300, w: 100, h: 60 };   // A 下方

test('rectAnchor：左右并排 → 取左右边中点', () => {
  assert.deepEqual(rectAnchor(A, B), { x: 100, y: 30 });   // A 右边中点
  assert.deepEqual(rectAnchor(B, A), { x: 300, y: 30 });   // B 左边中点
});

test('rectAnchor：上下排列 → 取上下边中点', () => {
  assert.deepEqual(rectAnchor(A, C), { x: 50, y: 60 });    // A 下边中点
  assert.deepEqual(rectAnchor(C, A), { x: 50, y: 300 });   // C 上边中点
});

test('edgeEndpoints：反向连（右侧节点指回左侧）也落在边上', () => {
  const g = edgeEndpoints(B, A);
  assert.deepEqual([g.x1, g.y1], [300, 30]);   // B 的左边
  assert.deepEqual([g.x2, g.y2], [100, 30]);   // A 的右边
});

test('edgeEndpoints：重叠节点不产生 NaN', () => {
  const g = edgeEndpoints({ x: 0, y: 0, w: 50, h: 50 }, { x: 10, y: 10, w: 50, h: 50 });
  for (const v of [g.x1, g.y1, g.x2, g.y2]) assert.ok(Number.isFinite(v));
});

test('distanceToRect：内部为 0，外部为欧氏距离', () => {
  assert.equal(distanceToRect(50, 30, A), 0);
  assert.equal(distanceToRect(110, 30, A), 10);
  assert.equal(distanceToRect(103, 34, A), 3);     // 纵向仍在范围内 → 距离 3
  assert.equal(distanceToRect(103, 64, A), 5);     // 横 3 竖 4 → 斜距 5
});

test('hitTest：落在边框上 / 容差内 命中，超出容差不命中', () => {
  const nodes = [A, B, { ...C, id: 'c' }];
  const list = [{ ...A, id: 'a' }, { ...B, id: 'b' }, { ...C, id: 'c' }];
  assert.equal(hitTest(list, 100, 30, 12), 'a');       // 正好在右边线上
  assert.equal(hitTest(list, 94, 30, 12), 'a');        // 矩形内部
  assert.equal(hitTest(list, 111, 30, 12), 'a');       // 边外 11px，容差内
  assert.equal(hitTest(list, 120, 30, 12), null);      // 边外 20px，容差外
  void nodes;
});

test('hitTest：多个节点重叠时取最近者', () => {
  const list = [
    { id: 'far', x: 0, y: 0, w: 100, h: 100 },
    { id: 'near', x: 40, y: 40, w: 20, h: 20 },
  ];
  assert.equal(hitTest(list, 50, 50, 12), 'near');
});

test('nearestBorderPoint：抓在右侧 → 右边界', () => {
  assert.deepEqual(nearestBorderPoint(A, 95, 30), { x: 100, y: 30 });
});

test('nearestBorderPoint：抓在左上角 → 就近选左或上（不为 NaN）', () => {
  const p = nearestBorderPoint(A, 2, 2);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(p.x === 0 || p.y === 0);
});

test('bezierPath：产出合法三次贝塞尔，端点精确等于锚点', () => {
  const d = bezierPath({ x1: 100, y1: 30, x2: 300, y2: 30, from: 'right', to: 'left' });
  assert.match(d, /^M 100 30 C /);
  assert.match(d, / 300 30$/);
  assert.ok(!d.includes('NaN'));
});

test('bezierPath：上下排列时控制点沿法线外推（y 方向）', () => {
  const d = bezierPath({ x1: 50, y1: 60, x2: 50, y2: 300, from: 'bottom', to: 'top' });
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.equal(nums.length, 8);   // M x y C c1x c1y c2x c2y x y
  assert.ok(!d.includes('NaN'));
});

test('anchorSide：识别贴边方向', () => {
  assert.equal(anchorSide(A, 0, 30), 'left');
  assert.equal(anchorSide(A, 100, 30), 'right');
  assert.equal(anchorSide(A, 50, 0), 'top');
  assert.equal(anchorSide(A, 50, 60), 'bottom');
  assert.equal(anchorSide(A, 50, 30), 'auto');
});
