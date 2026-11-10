// =========================================================================
// e2e_edge_ops.cjs —— edge-ops 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_edge_ops.cjs
//
// 覆盖：① 删除连线（右键菜单 / 标签 × / Delete 且只删一次）
//      ② 连线中间插入节点：A→X→B，命令留在上游
//      ③ 插入后 Insert 键入口 ④ 工具栏尺寸与悬浮球不重叠
//      ⑤ 无 JS 异常
// =========================================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findPlaywright() {
  if (process.env.PW_DIR) return process.env.PW_DIR;
  const base = `${process.env.HOME}/.npm/_npx`;
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = `${base}/${d}/node_modules/playwright`;
      if (fs.existsSync(p)) return p;
    }
  }
  return 'playwright';
}
function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  if (fs.existsSync(cache)) {
    const dir = fs.readdirSync(cache).find(n => /^chromium-\d+$/.test(n));
    if (dir) {
      const bin = `${cache}/${dir}/chrome`;
      if (fs.existsSync(bin)) return bin;
    }
  }
  return undefined;
}

const { chromium } = require(findPlaywright());
const CHROME = findChrome();
const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const HTML = path.join(ROOT, 'MutipleChat.html');
if (!fs.existsSync(HTML)) {
  console.error('缺少 ' + HTML + '，请先运行 node build.js');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✖', name, extra); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => {
    try { localStorage.removeItem('mc.floating'); localStorage.removeItem('mc.toolbarCollapsed'); } catch {}
  });
  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);

  // 浮窗会盖住画布，几何/点击类断言先收起
  const hidePanels = () => page.evaluate(() => HOST.hideFloatingPanels?.());

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 工具栏尺寸与悬浮球位置');
  const tb = await page.evaluate(() => {
    const t = document.getElementById('toolbar').getBoundingClientRect();
    const f = document.getElementById('toolbarFab').getBoundingClientRect();
    const overlap = !(t.right < f.left || t.left > f.right || t.bottom < f.top || t.top > f.bottom);
    return { w: t.width, h: t.height, overlap, tbBottom: t.bottom, fabTop: f.top };
  });
  check('工具栏宽度收敛（<=280px）', tb.w <= 280, 'w=' + tb.w);
  check('工具栏与悬浮球不重叠', tb.overlap === false, JSON.stringify(tb));

  console.log('\n[3] 删除连线：右键菜单');
  await hidePanels();
  const setup1 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 120, w: 240, h: 140, text: 'A' });
    const b = createNode('doc', { x: 640, y: 120, w: 240, h: 140, text: 'B' });
    const e = addEdge(a.id, b.id);
    e.command = '总结'; layoutEdgeLabel(e);
    redrawEdges();
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    return { aId: a.id, bId: b.id, eId: e.id, edges: Object.keys(state.edges).length };
  });
  await page.waitForTimeout(100);
  // 右键点在连线标签上
  const labelPos = await page.evaluate((eid) => {
    const r = state.edges[eid].labelEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, setup1.eId);
  await page.mouse.click(labelPos.x, labelPos.y, { button: 'right' });
  await page.waitForTimeout(150);
  const menu = await page.evaluate(() => {
    const m = document.getElementById('edgeMenu');
    return {
      exists: !!m,
      visible: !!m && !m.hidden,
      items: m ? [...m.querySelectorAll('button')].map(b => b.dataset.act) : [],
    };
  });
  check('右键弹出连线菜单', menu.exists && menu.visible, JSON.stringify(menu));
  check('菜单含「插入节点 / 删除连线」',
        menu.items.includes('insert') && menu.items.includes('delete'),
        JSON.stringify(menu.items));

  await page.click('#edgeMenu button[data-act="delete"]');
  await page.waitForTimeout(150);
  const afterDel = await page.evaluate(() => ({
    edges: Object.keys(state.edges).length,
    labels: document.querySelectorAll('.edge-label').length,
    menuHidden: document.getElementById('edgeMenu').hidden,
  }));
  check('右键删除后连线数为 0', afterDel.edges === 0, JSON.stringify(afterDel));
  check('标签 DOM 同步移除', afterDel.labels === 0, String(afterDel.labels));
  check('菜单已关闭', afterDel.menuHidden === true);

  console.log('\n[4] 删除连线：标签上的 × 按钮');
  const setup2 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 120, w: 240, h: 140, text: 'A' });
    const b = createNode('doc', { x: 640, y: 120, w: 240, h: 140, text: 'B' });
    const e = addEdge(a.id, b.id);
    selectEdge(e.id);
    redrawEdges();
    return { eId: e.id };
  });
  await page.waitForTimeout(120);
  const hasDelBtn = await page.evaluate((eid) =>
    !!state.edges[eid].labelEl.querySelector('.edge-del'), setup2.eId);
  check('选中连线时标签出现 × 按钮', hasDelBtn === true);

  if (hasDelBtn) {
    const box = await page.evaluate((eid) => {
      const r = state.edges[eid].labelEl.querySelector('.edge-del').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, setup2.eId);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(150);
    const n = await page.evaluate(() => Object.keys(state.edges).length);
    check('点 × 删除连线', n === 0, 'edges=' + n);
  }

  console.log('\n[5] Delete 键只删一次（重复绑定已收敛）');
  const setup3 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 120, w: 240, h: 140 });
    const b = createNode('doc', { x: 640, y: 120, w: 240, h: 140 });
    const e1 = addEdge(a.id, b.id);
    const e2 = addEdge(a.id, b.id);
    selectEdge(e1.id);
    return { e1: e1.id, e2: e2.id };
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  const afterKey = await page.evaluate(() => Object.keys(state.edges));
  check('Delete 只删掉选中的那一条',
        afterKey.length === 1 && afterKey[0] === setup3.e2,
        JSON.stringify(afterKey));

  console.log('\n[6] 连线中间插入节点');
  const setup4 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 200, w: 240, h: 140, text: 'A' });
    const b = createNode('doc', { x: 800, y: 200, w: 240, h: 140, text: 'B' });
    const e = addEdge(a.id, b.id);
    e.command = '总结'; layoutEdgeLabel(e);
    redrawEdges();
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    return {
      aId: a.id, bId: b.id, eId: e.id,
      midX: (80 + 240 + 800) / 2,
    };
  });
  const ins = await page.evaluate((eid) => {
    const n = insertNodeOnEdge(eid, 'doc');
    return {
      newId: n?.id,
      nodes: Object.keys(state.nodes).length,
      edges: Object.values(state.edges).map(e => ({ s: e.source, t: e.target, c: e.command })),
      x: n?.x, w: n?.w,
    };
  }, setup4.eId);
  check('插入后节点数为 3', ins.nodes === 3, String(ins.nodes));
  check('插入后连线数为 2', ins.edges.length === 2, JSON.stringify(ins.edges));
  const up = ins.edges.find(e => e.s === setup4.aId);
  const down = ins.edges.find(e => e.t === setup4.bId);
  check('存在 A → X', !!up && up.t === ins.newId, JSON.stringify(ins.edges));
  check('存在 X → B', !!down && down.s === ins.newId, JSON.stringify(ins.edges));
  check('命令留在上游 A → X', up?.c === '总结', JSON.stringify(up));
  check('下游 X → B 命令为空', down?.c === '', JSON.stringify(down));
  check('新节点落在两节点中点附近',
        Math.abs((ins.x + ins.w / 2) - (setup4.midX + 0)) < 260,
        `x=${ins.x} midX=${setup4.midX}`);
  const oldGone = await page.evaluate((eid) => !state.edges[eid], setup4.eId);
  check('原连线已移除', oldGone === true);

  console.log('\n[7] Insert 键在选中连线上插入节点');
  const setup5 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 120, w: 240, h: 140 });
    const b = createNode('doc', { x: 640, y: 120, w: 240, h: 140 });
    const e = addEdge(a.id, b.id);
    selectEdge(e.id);
    return { eId: e.id, nodes: Object.keys(state.nodes).length };
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Insert');
  await page.waitForTimeout(150);
  const afterIns = await page.evaluate(() => ({
    nodes: Object.keys(state.nodes).length,
    edges: Object.keys(state.edges).length,
  }));
  check('Insert 后节点 +1', afterIns.nodes === setup5.nodes + 1, JSON.stringify(afterIns));
  check('Insert 后连线数为 2', afterIns.edges === 2, JSON.stringify(afterIns));

  console.log('\n[8] 插入节点的区域继承');
  const zone = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const z = createZone({ title: '区', x: 40, y: 40, w: 900, h: 500 });
    const a = createNode('doc', { x: 120, y: 160, w: 200, h: 120, zoneId: z.id });
    const b = createNode('doc', { x: 700, y: 160, w: 200, h: 120, zoneId: z.id });
    const e = addEdge(a.id, b.id);
    const n = insertNodeOnEdge(e.id, 'doc');
    return { newZone: n?.zoneId, zoneId: z.id };
  });
  check('新节点继承上游区域', zone.newZone === zone.zoneId, JSON.stringify(zone));

  console.log('\n[9] 异常兜底');
  const bad = await page.evaluate(() => {
    const r = insertNodeOnEdge('e9999', 'doc');
    return { ret: r === null || r === undefined, edges: Object.keys(state.edges).length };
  });
  check('对不存在的连线插入返回空且不抛错', bad.ret === true);

  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
