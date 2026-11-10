// =========================================================================
// e2e_toggle_zindex.cjs —— 窄屏下大纲/对话侧栏「展开后收不回」的回归测试
//
//   先构建：node build.js
//   再运行：node tests/e2e_toggle_zindex.cjs
//
// 真实事故：<=1024px 时 #outline/#sidebar 是 position:absolute 浮层且
// z-index:50，而 #toggleOutline/#toggleSidebar 只有 z-index:31，位置又正好
// 落在侧栏头部（.ol-tabs / .sb-head）上方 —— 按钮被盖住，点击命中的是侧栏，
// 于是侧栏一展开就再也收不回去。
//
// 断言方式用 elementFromPoint：它等价于「用户手指点下去命中了谁」，
// 比断言 z-index 数值更贴近真实故障（数值对了但位置重叠依然会挡住）。
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

// 按钮中心点上「命中的元素」是谁（含祖先 id，便于看出被谁挡住）
const hitAt = (sel) => `(() => {
  const b = document.querySelector('${sel}');
  if (!b) return 'missing';
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!el) return 'none';
  const owner = el.closest('[id]');
  return (owner ? owner.id : el.tagName);
})()`;

// 等待某个侧栏的 collapsed 状态变成期望值（class 切换是同步的，
// 但 transition 会让「视觉上」滞后；这里只看 class，故无需定时长）。
async function waitCollapsed(page, id, want) {
  await page.waitForFunction(
    ([i, w]) => document.getElementById(i).classList.contains('collapsed') === w,
    [id, want],
    { timeout: 3000 },
  );
}

async function probe(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto('file://' + HTML);
  await page.waitForTimeout(350);

  const tag = `${width}x${height}`;
  console.log(`\n[${tag}]`);

  // 基线：窄屏（<=1024px）启动时自动折叠两侧栏，桌面则展开。
  // 测试必须主动把两边摆到“已收起”再开始，否则第一次点击方向就相反。
  await page.evaluate(() => {
    document.getElementById('outline').classList.add('collapsed');
    document.getElementById('sidebar').classList.add('collapsed');
  });
  await waitCollapsed(page, 'outline', true);
  await waitCollapsed(page, 'sidebar', true);

  // ---- 折叠态：两个按钮都该可点 ----
  check(`${tag} 折叠态 #toggleOutline 可命中`,
    (await page.evaluate(hitAt('#toggleOutline'))) === 'toggleOutline',
    await page.evaluate(hitAt('#toggleOutline')));
  check(`${tag} 折叠态 #toggleSidebar 可命中`,
    (await page.evaluate(hitAt('#toggleSidebar'))) === 'toggleSidebar',
    await page.evaluate(hitAt('#toggleSidebar')));

  // ---- 大纲：展开 → 再点应收起 ----
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  const oExpanded = await page.evaluate(() =>
    !document.getElementById('outline').classList.contains('collapsed'));
  check(`${tag} 大纲已展开`, oExpanded === true);
  check(`${tag} 展开后 #toggleOutline 仍可命中（不被侧栏盖住）`,
    (await page.evaluate(hitAt('#toggleOutline'))) === 'toggleOutline',
    await page.evaluate(hitAt('#toggleOutline')));

  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', true);
  const oCollapsed = await page.evaluate(() =>
    document.getElementById('outline').classList.contains('collapsed'));
  check(`${tag} 大纲可收回`, oCollapsed === true);

  // ---- 对话：展开 → 再点应收起 ----
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  const sExpanded = await page.evaluate(() =>
    !document.getElementById('sidebar').classList.contains('collapsed'));
  check(`${tag} 对话栏已展开`, sExpanded === true);
  check(`${tag} 展开后 #toggleSidebar 仍可命中（不被侧栏盖住）`,
    (await page.evaluate(hitAt('#toggleSidebar'))) === 'toggleSidebar',
    await page.evaluate(hitAt('#toggleSidebar')));

  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', true);
  const sCollapsed = await page.evaluate(() =>
    document.getElementById('sidebar').classList.contains('collapsed'));
  check(`${tag} 对话栏可收回`, sCollapsed === true);

  // ---- 两侧同时展开再同时收起（用户实际最常触发的路径）----
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', true);
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', true);
  const both = await page.evaluate(() => ({
    o: document.getElementById('outline').classList.contains('collapsed'),
    s: document.getElementById('sidebar').classList.contains('collapsed'),
  }));
  check(`${tag} 两侧同时展开后都能收回`, both.o === true && both.s === true,
    JSON.stringify(both));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // 窄屏（平板竖屏 / 手机横屏）：事故现场
  await probe(browser, 900, 700);
  // 更窄：手机竖屏
  await probe(browser, 420, 820);
  // 桌面宽度：侧栏在文档流内，作为对照保证没有回归
  await probe(browser, 1280, 800);

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
