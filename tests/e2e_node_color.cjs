// =========================================================================
// e2e_node_color.cjs —— node-color 的端到端验证
//   先构建：node build.js  再运行：node tests/e2e_node_color.cjs
//
// 覆盖：① 右键菜单有「命令前/命令后」两项且各自行为正确
//      ② 标签 ＋ 弹出同一菜单 ③ Shift+Insert = 命令后
//      ④ 卡片配色：调色板设置/清除/持久化 ⑤ 旧数据无 color 照常导入
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
  const hidePanels = () => page.evaluate(() => HOST.hideFloatingPanels?.());

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 右键菜单包含两个插入位置');
  await hidePanels();
  const setup = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 200, w: 240, h: 140, text: 'A' });
    const b = createNode('doc', { x: 800, y: 200, w: 240, h: 140, text: 'B' });
    const e = addEdge(a.id, b.id);
    e.command = '总结'; layoutEdgeLabel(e); redrawEdges();
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    return { eId: e.id };
  });
  await page.waitForTimeout(120);
  const lp = await page.evaluate((eid) => {
    const r = state.edges[eid].labelEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, setup.eId);
  await page.mouse.click(lp.x, lp.y, { button: 'right' });
  await page.waitForTimeout(150);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('#edgeMenu button')].map(b => b.dataset.act));
  check('菜单含 insert-before', items.includes('insert-before'), JSON.stringify(items));
  check('菜单含 insert-after', items.includes('insert-after'), JSON.stringify(items));

  console.log('\n[3] 「命令前插入」：A →(空) X →(总结) B');
  await page.click('#edgeMenu button[data-act="insert-before"]');
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => Object.values(state.edges)
    .map(e => `${e.source}->${e.target}(${e.command || '空'})`));
  const upstreamEmpty = before.some(l => l.includes('(空)'));
  const downstreamCmd = before.some(l => l.includes('(总结)'));
  check('存在一条空命令连线（A→X）', upstreamEmpty, JSON.stringify(before));
  check('存在一条带原命令的连线（X→B）', downstreamCmd, JSON.stringify(before));

  console.log('\n[4] 「命令后插入」：A →(总结) X →(空) B');
  const setup2 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 200, w: 240, h: 140 });
    const b = createNode('doc', { x: 800, y: 200, w: 240, h: 140 });
    const e = addEdge(a.id, b.id);
    e.command = '总结';
    return { eId: e.id, aId: a.id };
  });
  await page.evaluate((eid) => insertNodeOnEdge(eid, 'doc', 'after'), setup2.eId);
  await page.waitForTimeout(120);
  const after = await page.evaluate((aId) => {
    const e = Object.values(state.edges).find(x => x.source === aId);
    return { cmd: e?.command, total: Object.keys(state.edges).length };
  }, setup2.aId);
  check('命令留在上游', after.cmd === '总结', JSON.stringify(after));
  check('连线数为 2', after.total === 2, JSON.stringify(after));

  console.log('\n[5] Shift+Insert 等价于「命令后」');
  const setup3 = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const a = createNode('doc', { x: 80, y: 200, w: 240, h: 140 });
    const b = createNode('doc', { x: 800, y: 200, w: 240, h: 140 });
    const e = addEdge(a.id, b.id);
    e.command = '总结';
    selectEdge(e.id);
    return { aId: a.id };
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Shift+Insert');
  await page.waitForTimeout(150);
  const shiftIns = await page.evaluate((aId) => {
    const e = Object.values(state.edges).find(x => x.source === aId);
    return { cmd: e?.command };
  }, setup3.aId);
  check('Shift+Insert 后命令仍在上游', shiftIns.cmd === '总结', JSON.stringify(shiftIns));

  console.log('\n[6] 卡片配色');
  const color = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const n = createNode('doc', { x: 100, y: 100, w: 240, h: 140, text: 'C' });
    setNodeColor(n.id, 'blue');
    const hasAttr = n.el.getAttribute('data-color');
    const barBg = getComputedStyle(n.el.querySelector('.bar')).backgroundColor;
    setNodeColor(n.id, 'blue');      // 重复设置不应出错
    setNodeColor(n.id, 'pink');      // 非法值回退
    const afterBad = n.color;
    setNodeColor(n.id, null);
    const cleared = n.el.getAttribute('data-color');
    return { hasAttr, barBg, afterBad, cleared };
  });
  check('设置颜色写入 data-color', color.hasAttr === 'blue', JSON.stringify(color));
  check('标题栏底色随颜色变化', color.barBg && color.barBg !== 'rgba(0, 0, 0, 0)', color.barBg);
  check('非法颜色回退为默认', color.afterBad === null, JSON.stringify(color));
  check('清除后移除 data-color', color.cleared === null, JSON.stringify(color));

  console.log('\n[7] 颜色持久化到导出数据');
  const exported = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const n = createNode('doc', { x: 100, y: 100 });
    setNodeColor(n.id, 'purple');
    const d1 = exportCanvasData().nodes.find(x => x.id === n.id);
    setNodeColor(n.id, null);
    const d2 = exportCanvasData().nodes.find(x => x.id === n.id);
    return { withColor: d1.color, withoutColor: 'color' in d2 };
  });
  check('导出带 color', exported.withColor === 'purple', JSON.stringify(exported));
  check('默认色时不写 color 字段（兼容旧格式）', exported.withoutColor === false, JSON.stringify(exported));

  console.log('\n[8] 旧画布（无 color 字段）照常导入');
  const legacy = await page.evaluate(() => {
    const data = {
      format: 'mutiplechat-canvas', version: 1,
      nodes: [{ id: 'n1', kind: 'doc', title: '旧', x: 10, y: 10, w: 200, h: 120, text: 'x' }],
      edges: [], zones: [], tasks: [],
    };
    importCanvasData(data);
    const n = state.nodes['n1'];
    return { color: n?.color, attr: n?.el.getAttribute('data-color') };
  });
  check('旧数据导入后 color 为 null', legacy.color === null, JSON.stringify(legacy));
  check('旧数据导入后无 data-color 属性', legacy.attr === null, JSON.stringify(legacy));

  console.log('\n[9] 数字键快速上色');
  const keyColor = await page.evaluate(() => {
    clearCanvas(); HOST.syncEmptyHint();
    const n = createNode('doc', { x: 100, y: 100 });
    selectNode(n.id);
    return n.id;
  });
  await page.waitForTimeout(80);
  await page.keyboard.press('3');
  await page.waitForTimeout(100);
  const kc = await page.evaluate((id) => state.nodes[id]?.color, keyColor);
  check('数字键 3 → orange', kc === 'orange', String(kc));

  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
