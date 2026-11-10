// =========================================================================
// test_edgeops.mjs —— planInsertOnEdge 的纯逻辑单测（node --test，无需浏览器）
//
//   运行：node --test tests/test_edgeops.mjs
// =========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { canRemoveEdge, planInsertOnEdge } from '../js/edgeops.js';

const src = { id: 'n1', x: 80, y: 200, w: 240, h: 140, zoneId: 'z1' };
const dst = { id: 'n2', x: 800, y: 200, w: 240, h: 140, zoneId: 'z2' };

test('插入点位于两节点中心的中点', () => {
  const p = planInsertOnEdge(src, dst, { id: 'e1', command: '' }, { width: 300, height: 160 });
  const midX = ((src.x + src.w / 2) + (dst.x + dst.w / 2)) / 2;   // (200 + 920) / 2 = 560
  const midY = 270;
  assert.equal(p.valid, true);
  assert.equal(p.x + p.w / 2, midX);
  assert.equal(p.y + p.h / 2, midY);
});

test('默认（before）命令在下游，上游为空', () => {
  const p = planInsertOnEdge(src, dst, { id: 'e1', command: '🖐️总结' });
  assert.equal(p.upstreamCommand, '');
  assert.equal(p.downstreamCommand, '🖐️总结');
});

test('新节点继承上游区域', () => {
  const p = planInsertOnEdge(src, dst, { id: 'e1', command: '' });
  assert.equal(p.zoneId, 'z1');
});

test('上游没有区域时新节点也没有区域', () => {
  const p = planInsertOnEdge({ ...src, zoneId: null }, dst, { id: 'e1', command: '' });
  assert.equal(p.zoneId, null);
});

test('上游 zoneId 字段缺失时安全降级为 null', () => {
  const { zoneId, ...srcNoZone } = src;
  const p = planInsertOnEdge(srcNoZone, dst, { id: 'e1', command: '' });
  assert.equal(p.zoneId, null);
});

test('端点缺失时 valid=false 且不抛错', () => {
  assert.equal(planInsertOnEdge(null, dst, { command: 'x' }).valid, false);
  assert.equal(planInsertOnEdge(src, undefined, { command: 'x' }).valid, false);
  assert.equal(planInsertOnEdge(null, null, null).valid, false);
});

test('端点缺失时不继承区域、不带命令（保留原连线由调用方负责）', () => {
  const p = planInsertOnEdge(null, null, { command: '🖐️总结' });
  assert.equal(p.zoneId, null);
  assert.equal(p.upstreamCommand, '');
});

test('edge 为空时命令视为空串', () => {
  const p = planInsertOnEdge(src, dst, null);
  assert.equal(p.upstreamCommand, '');
  assert.equal(p.valid, true);
});

test('默认尺寸为 300×160', () => {
  const p = planInsertOnEdge(src, dst, { command: '' });
  assert.equal(p.w, 300);
  assert.equal(p.h, 160);
});

test('结果坐标取整（避免半像素导致的模糊渲染）', () => {
  const odd = { ...src, x: 81, y: 201, w: 241, h: 141 };
  const p = planInsertOnEdge(odd, dst, { command: '' }, { width: 301, height: 161 });
  assert.equal(Number.isInteger(p.x), true);
  assert.equal(Number.isInteger(p.y), true);
});

test('canRemoveEdge：存在即可删，不存在返回 false', () => {
  const edges = { e1: { id: 'e1' } };
  assert.equal(canRemoveEdge(edges, 'e1'), true);
  assert.equal(canRemoveEdge(edges, 'e2'), false);
  assert.equal(canRemoveEdge(edges, null), false);
  assert.equal(canRemoveEdge(null, 'e1'), false);
});

// =========================================================================
// 插入位置：before / after（feat: node-color）
// =========================================================================
test('默认位置是 before：命令移到下游', () => {
  const p = planInsertOnEdge(src, dst, { command: '🖐️总结' });
  assert.equal(p.upstreamCommand, '');
  assert.equal(p.downstreamCommand, '🖐️总结');
  assert.equal(p.position, 'before');
});

test('position=after：命令留在上游', () => {
  const p = planInsertOnEdge(src, dst, { command: '🖐️总结' }, { position: 'after' });
  assert.equal(p.upstreamCommand, '🖐️总结');
  assert.equal(p.downstreamCommand, '');
  assert.equal(p.position, 'after');
});

test('position=before 显式指定与默认一致', () => {
  const a = planInsertOnEdge(src, dst, { command: 'X' });
  const b = planInsertOnEdge(src, dst, { command: 'X' }, { position: 'before' });
  assert.deepEqual(a, b);
});

test('非法 position 回退为 before', () => {
  for (const bad of ['middle', '', null, undefined, 42, {}]) {
    const p = planInsertOnEdge(src, dst, { command: 'cmd' }, { position: bad });
    assert.equal(p.position, 'before');
    assert.equal(p.downstreamCommand, 'cmd');
    assert.equal(p.upstreamCommand, '');
  }
});

test('两种位置下命令都只会出现在一条线上（不会丢也不会重复）', () => {
  for (const position of ['before', 'after']) {
    const p = planInsertOnEdge(src, dst, { command: '🖐️A' }, { position });
    const total = [p.upstreamCommand, p.downstreamCommand].filter(Boolean).length;
    assert.equal(total, 1, 'position=' + position);
  }
});

test('空命令时两种位置结果都是空（无副作用）', () => {
  for (const position of ['before', 'after']) {
    const p = planInsertOnEdge(src, dst, { command: '' }, { position });
    assert.equal(p.upstreamCommand, '');
    assert.equal(p.downstreamCommand, '');
  }
});

test('位置不影响几何（只影响命令归属）', () => {
  const before = planInsertOnEdge(src, dst, { command: 'x' }, { position: 'before' });
  const after = planInsertOnEdge(src, dst, { command: 'x' }, { position: 'after' });
  assert.equal(before.x, after.x);
  assert.equal(before.y, after.y);
  assert.equal(before.zoneId, after.zoneId);
});

test('端点缺失时 position 字段仍然回填（调用方不必判空）', () => {
  const p = planInsertOnEdge(null, dst, { command: 'x' }, { position: 'after' });
  assert.equal(p.valid, false);
  assert.equal(p.position, 'after');
});
