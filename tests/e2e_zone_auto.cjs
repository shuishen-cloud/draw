// =========================================================================
// e2e_zone_auto.cjs —— zone-auto-assign 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_zone_auto.cjs
//
// 覆盖：拖入区域自动归属、拖出清空、区域拖动不改归属、
//       手动下拉可覆盖、重叠取面积最小、大纲同步。
// 路径可用环境变量覆盖：PW_DIR / CHROME_BIN
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

// 用「直接设置坐标 + 触发归属判定」的方式模拟拖动结束，
// 避免依赖像素级拖拽的脆弱性；真实拖动由 touch_link 套件覆盖。
const SIM_DRAG = `
  function simDrop(nodeId, wx, wy) {
    const n = state.nodes[nodeId];
    if (!n) return null;
    n.x = wx - n.w / 2;
    n.y = wy - n.h / 2;
    layoutNode(n);
    return autoAssignZone(n);
  }
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 900 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);
  await page.addScriptTag({ content: SIM_DRAG });

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 纯几何判定 zoneAtPoint');
  const geo = await page.evaluate(() => {
    clearCanvas();
    const z1 = createZone({ title: 'A', x: 0, y: 0, w: 300, h: 300 });
    return {
      inside: zoneAtPoint(150, 150)?.id ?? null,
      outside: zoneAtPoint(999, 999),
      edge: zoneAtPoint(300, 300)?.id ?? null,
      zoneId: z1.id,
    };
  });
  check('区域内命中', geo.inside === geo.zoneId, JSON.stringify(geo));
  check('区域外为 null', geo.outside === null, String(geo.outside));
  check('右下边界命中', geo.edge === geo.zoneId, String(geo.edge));

  console.log('\n[3] 拖入区域 → 自动归属');
  const dropIn = await page.evaluate((zid) => {
    const n = createNode('doc', { x: 900, y: 900, w: 200, h: 120, text: 'x' });
    const before = n.zoneId;
    const ret = simDrop(n.id, 150, 150);   // 落在区域 A 内
    return {
      before, ret,
      after: n.zoneId,
      pickValue: n.el.querySelector('.zone-pick').value,
      zoneId: zid,
    };
  }, geo.zoneId);
  check('拖入前 zoneId 为 null', dropIn.before === null, String(dropIn.before));
  check('拖入后 zoneId 为该区域', dropIn.after === dropIn.zoneId,
        `${dropIn.after} vs ${dropIn.zoneId}`);
  check('autoAssignZone 返回新归属', dropIn.ret === dropIn.zoneId, String(dropIn.ret));
  check('下拉框同步显示该区域', dropIn.pickValue === dropIn.zoneId, dropIn.pickValue);

  console.log('\n[4] 拖出区域 → 归属清空');
  const dropOut = await page.evaluate(() => {
    const n = Object.values(state.nodes).find(x => x.zoneId);
    const before = n.zoneId;
    const ret = simDrop(n.id, 2000, 2000);   // 远离所有区域
    return { before, ret, after: n.zoneId, pickValue: n.el.querySelector('.zone-pick').value };
  });
  check('拖出前有归属', !!dropOut.before, String(dropOut.before));
  check('拖出后 zoneId 为 null', dropOut.after === null, String(dropOut.after));
  check('autoAssignZone 返回 null', dropOut.ret === null, String(dropOut.ret));
  check('下拉框回到「未分类」', dropOut.pickValue === '', dropOut.pickValue);

  console.log('\n[5] 重叠区域：归面积最小者');
  const overlap = await page.evaluate(() => {
    clearCanvas();
    const big = createZone({ title: '大', x: 0, y: 0, w: 500, h: 500 });
    const small = createZone({ title: '小', x: 100, y: 100, w: 120, h: 120 });
    const n = createNode('doc', { x: 0, y: 0, w: 100, h: 80, text: 'y' });
    simDrop(n.id, 160, 160);        // 两区域都覆盖
    const inBoth = n.zoneId;
    simDrop(n.id, 40, 40);          // 只在大区域
    const onlyBig = n.zoneId;
    return { inBoth, onlyBig, bigId: big.id, smallId: small.id };
  });
  check('重叠处归小区域', overlap.inBoth === overlap.smallId,
        `${overlap.inBoth} vs ${overlap.smallId}`);
  check('仅大区域处归大区域', overlap.onlyBig === overlap.bigId,
        `${overlap.onlyBig} vs ${overlap.bigId}`);

  console.log('\n[6] 归属无变化时不重复写入');
  const noChange = await page.evaluate(() => {
    const n = Object.values(state.nodes)[0];
    const z = Object.values(state.zones).find(x => x.id === n.zoneId);
    let logs = 0;
    const orig = DBG.log;
    DBG.log = (...a) => { if (String(a[0]).includes('自动归属')) logs++; };
    simDrop(n.id, z.x + z.w / 2, z.y + z.h / 2);   // 已在区域内再拖一次
    DBG.log = orig;
    return { zoneId: n.zoneId, logs };
  });
  check('归属保持', !!noChange.zoneId, String(noChange.zoneId));
  check('无变化时不打「自动归属」日志', noChange.logs === 0, 'logs=' + noChange.logs);

  console.log('\n[7] 手动下拉仍可覆盖（拖动的反方向）');
  const manual = await page.evaluate(() => {
    clearCanvas();
    const a = createZone({ title: '甲', x: 0, y: 0, w: 300, h: 300 });
    const b = createZone({ title: '乙', x: 600, y: 0, w: 300, h: 300 });
    const n = createNode('doc', { x: 0, y: 0, w: 100, h: 80, text: 'z' });
    simDrop(n.id, 150, 150);          // 自动归到甲
    const auto = n.zoneId;
    // 手动改成乙
    const pick = n.el.querySelector('.zone-pick');
    pick.value = b.id;
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    const afterManual = n.zoneId;
    return { auto, afterManual, aId: a.id, bId: b.id };
  });
  check('自动归属到甲', manual.auto === manual.aId, String(manual.auto));
  check('手动可改为乙', manual.afterManual === manual.bId, String(manual.afterManual));

  console.log('\n[8] 区域拖动连带移动，节点归属不变');
  const zoneDrag = await page.evaluate(() => {
    clearCanvas();
    const z = createZone({ title: '带', x: 100, y: 100, w: 400, h: 300 });
    const n = createNode('doc', { x: 150, y: 150, w: 100, h: 80, text: 'w' });
    simDrop(n.id, 200, 200);
    const before = n.zoneId;
    // 模拟区域拖动（改动 zone 与节点坐标，但不调用 autoAssignZone）
    const orig = DBG.log;
    let autoLogs = 0;
    DBG.log = (...a) => { if (String(a[0]).includes('自动归属')) autoLogs++; };
    z.x -= 800; z.y -= 800;
    layoutZone(z);
    n.x -= 800; n.y -= 800;
    layoutNode(n);
    DBG.log = orig;
    return { before, after: n.zoneId, autoLogs };
  });
  check('区域拖动前后归属不变', zoneDrag.before === zoneDrag.after,
        `${zoneDrag.before} -> ${zoneDrag.after}`);
  check('区域拖动不触发自动归属', zoneDrag.autoLogs === 0, 'logs=' + zoneDrag.autoLogs);

  console.log('\n[9] 大纲跟随归属变化');
  const outline = await page.evaluate(() => {
    clearCanvas();
    const z = createZone({ title: '大纲区', x: 0, y: 0, w: 300, h: 300 });
    const n = createNode('doc', { x: 900, y: 900, w: 100, h: 80, text: 'q' });
    simDrop(n.id, 150, 150);
    const html = document.querySelector('.ol-body')?.innerHTML || '';
    return { hasZoneTitle: html.includes('大纲区'), zoneId: n.zoneId, zId: z.id };
  });
  check('大纲里出现区域标题', outline.hasZoneTitle, 'zoneId=' + outline.zoneId);

  console.log('\n[10] 导出数据包含 zoneId');
  const exp = await page.evaluate(() => {
    const d = exportCanvasData();
    const withZone = d.nodes.filter(n => n.zoneId).length;
    return { total: d.nodes.length, withZone, version: d.version };
  });
  check('导出含 zoneId 且 version 未变', exp.withZone >= 1 && exp.version === 1,
        JSON.stringify(exp));

  console.log('\n[11] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
