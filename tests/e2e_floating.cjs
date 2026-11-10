// =========================================================================
// e2e_floating.cjs —— floating-ui 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_floating.cjs
//
// 覆盖：① 浮窗不占文档流（画布满宽）② 拖头部移动 + 位置持久化
//      ③ 折叠/展开 ④ 悬浮球开关工具栏 ⑤ 拖拽后不越界
//      ⑥ 窄屏仍可见 ⑦ 无 JS 异常
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

const clearPrefs = `
  try { localStorage.removeItem('mc.floating'); localStorage.removeItem('mc.toolbarCollapsed'); } catch {}
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(clearPrefs);
  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 侧栏是浮窗，不占文档流');
  const layout = await page.evaluate(() => {
    const ol = document.getElementById('outline');
    const sb = document.getElementById('sidebar');
    const cw = document.getElementById('canvasWrap');
    return {
      olPos: getComputedStyle(ol).position,
      sbPos: getComputedStyle(sb).position,
      olParent: ol.parentElement.id,
      sbParent: sb.parentElement.id,
      canvasW: cw.getBoundingClientRect().width,
      winW: window.innerWidth,
      olW: ol.getBoundingClientRect().width,
      sbW: sb.getBoundingClientRect().width,
    };
  });
  check('#outline 是 absolute 浮窗', layout.olPos === 'absolute', layout.olPos);
  check('#sidebar 是 absolute 浮窗', layout.sbPos === 'absolute', layout.sbPos);
  check('#outline 挂在 #canvasWrap 内', layout.olParent === 'canvasWrap', layout.olParent);
  check('#sidebar 挂在 #canvasWrap 内', layout.sbParent === 'canvasWrap', layout.sbParent);
  check('画布占满宽度（不被侧栏压缩）',
        Math.abs(layout.canvasW - layout.winW) <= 1,
        JSON.stringify(layout));

  console.log('\n[3] 拖拽头部移动浮窗');
  const before = await page.evaluate(() => {
    const r = document.getElementById('outline').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const hb = await page.evaluate(() => {
    const r = document.querySelector('#outline .ol-tabs').getBoundingClientRect();
    return { x: r.left + r.width / 2 - 20, y: r.top + r.height / 2 };
  });
  await page.mouse.move(hb.x, hb.y);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 90, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => {
    const r = document.getElementById('outline').getBoundingClientRect();
    return { x: r.left, y: r.top, saved: JSON.parse(localStorage.getItem('mc.floating') || '{}') };
  });
  check('拖动后 x 变化', Math.abs(after.x - before.x) > 60, `${before.x} -> ${after.x}`);
  check('拖动后 y 变化', Math.abs(after.y - before.y) > 40, `${before.y} -> ${after.y}`);
  check('位置写入 localStorage', !!after.saved.outline, JSON.stringify(after.saved));

  await page.reload();
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => {
    const r = document.getElementById('outline').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('刷新后恢复位置',
        Math.abs(restored.x - Math.round(after.x)) <= 2 && Math.abs(restored.y - Math.round(after.y)) <= 2,
        `${JSON.stringify(restored)} vs ${JSON.stringify(after)}`);

  console.log('\n[4] 折叠 / 展开');
  const col = await page.evaluate(() => {
    const el = document.getElementById('outline');
    const body = el.querySelector('.ol-pane');
    const h0 = el.getBoundingClientRect().height;
    el.querySelector('#olClose').click();
    const h1 = el.getBoundingClientRect().height;
    const collapsed = el.classList.contains('collapsed');
    el.querySelector('#olClose').click();
    const h2 = el.getBoundingClientRect().height;
    return { h0, h1, h2, collapsed, expanded: !el.classList.contains('collapsed') };
  });
  check('点击折叠按钮进入 collapsed', col.collapsed === true);
  check('折叠后高度变小', col.h1 < col.h0, JSON.stringify(col));
  check('再次点击可展开', col.expanded === true && col.h2 > col.h1, JSON.stringify(col));

  console.log('\n[5] 悬浮球开关工具栏');
  const fab = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const fab = document.getElementById('toolbarFab');
    return {
      fabExists: !!fab,
      fabVisible: fab && getComputedStyle(fab).display !== 'none',
      tbFolded0: tb.classList.contains('folded'),
      tbVisible0: getComputedStyle(tb).display !== 'none',
    };
  });
  check('存在悬浮球', fab.fabExists && fab.fabVisible);
  check('桌面默认展开工具栏', fab.tbFolded0 === false && fab.tbVisible0 === true, JSON.stringify(fab));
  await page.click('#toolbarFab');
  await page.waitForTimeout(120);
  const folded = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    return { folded: tb.classList.contains('folded'), saved: localStorage.getItem('mc.toolbarCollapsed') };
  });
  check('点悬浮球收起工具栏', folded.folded === true);
  check('折叠状��已持久化', folded.saved === '1', String(folded.saved));
  await page.click('#toolbarFab');
  await page.waitForTimeout(120);
  const unfolded = await page.evaluate(() => document.getElementById('toolbar').classList.contains('folded'));
  check('再点一次展开工具栏', unfolded === false);

  console.log('\n[6] 工具栏本身可拖拽');
  const tbMove = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const r = tb.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  const th = await page.evaluate(() => {
    const r = document.querySelector('#toolbar .tb-head').getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  });
  await page.mouse.move(th.x, th.y);
  await page.mouse.down();
  await page.mouse.move(th.x + 90, th.y - 70, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const tbAfter = await page.evaluate(() => {
    const r = document.getElementById('toolbar').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  check('工具栏可拖动', Math.abs(tbAfter.x - tbMove.x) > 40 || Math.abs(tbAfter.y - tbMove.y) > 40,
        `${JSON.stringify(tbMove)} -> ${JSON.stringify(tbAfter)}`);

  console.log('\n[7] 拖出视口会被夹紧');
  const clamped = await page.evaluate(() => {
    const el = document.getElementById('sidebar');
    el.style.left = '9999px';
    el.style.top = '9999px';
    window.dispatchEvent(new Event('resize'));
    const r = el.getBoundingClientRect();
    const wrap = document.getElementById('canvasWrap').getBoundingClientRect();
    return { right: r.right, wrapRight: wrap.right + 1, top: r.top, wrapBottom: wrap.bottom + 1 };
  });
  await page.waitForTimeout(120);
  const clamped2 = await page.evaluate(() => {
    const r = document.getElementById('sidebar').getBoundingClientRect();
    const wrap = document.getElementById('canvasWrap').getBoundingClientRect();
    return { insideX: r.left < wrap.right, insideY: r.top < wrap.bottom };
  });
  check('resize 后浮窗仍在可视区', clamped2.insideX && clamped2.insideY, JSON.stringify(clamped2));

  console.log('\n[8] 窄屏：浮窗可见且工具栏默认折叠');
  const narrowCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const np = await narrowCtx.newPage();
  const nerrs = [];
  np.on('pageerror', e => nerrs.push(e.message));
  await np.addInitScript(clearPrefs);
  await np.goto('file://' + HTML);
  await np.waitForTimeout(500);
  const narrow = await np.evaluate(() => {
    const ol = document.getElementById('outline');
    const sb = document.getElementById('sidebar');
    const fab = document.getElementById('toolbarFab');
    const tb = document.getElementById('toolbar');
    return {
      olVisible: ol.getBoundingClientRect().width > 0 && getComputedStyle(ol).display !== 'none',
      sbVisible: sb.getBoundingClientRect().width > 0 && getComputedStyle(sb).display !== 'none',
      olInside: ol.getBoundingClientRect().left >= 0 && ol.getBoundingClientRect().right <= window.innerWidth,
      sbInside: sb.getBoundingClientRect().left >= 0 && sb.getBoundingClientRect().right <= window.innerWidth,
      fabVisible: fab.getBoundingClientRect().width > 0,
      tbFolded: tb.classList.contains('folded'),
    };
  });
  check('窄屏大纲浮窗可见', narrow.olVisible === true);
  check('窄屏对话浮窗可见', narrow.sbVisible === true);
  check('窄屏浮窗在视口内', narrow.olInside && narrow.sbInside, JSON.stringify(narrow));
  check('窄屏悬浮球可见', narrow.fabVisible === true);
  check('窄屏工具栏默认折叠', narrow.tbFolded === true);
  check('窄屏无 JS 异常', nerrs.length === 0, nerrs.join(' | '));
  await narrowCtx.close();

  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
