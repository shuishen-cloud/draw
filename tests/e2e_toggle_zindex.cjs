// =========================================================================
// e2e_toggle_zindex.cjs —— 窄屏侧栏「展开后收不回」的回归测试
//
//   先构建：node build.js
//   再运行：node tests/e2e_toggle_zindex.cjs
//
// 真实事故（三次迭代才收敛，记录以便不再踩）：
//   1) <=1024px 时 #outline/#sidebar 是 position:absolute 浮层、z-index:50，
//      而 #toggleOutline/#toggleSidebar 只有 z-index:31，位置又正好在侧栏头部
//      (.ol-tabs / .sb-head) 上方 → 按钮被盖住，一展开就再也收不回去。
//   2) 只把 z-index 提到 51 → 按钮反过来盖住侧栏里的「⭐ 收藏」「清空」。
//   3) 让按钮随侧栏平移 → 420px 下侧栏宽 78vw，两个按钮平移后自己重叠。
//
//   最终方案：窄屏侧栏是「抽屉」。展开时外部开关让位（隐藏），
//   由侧栏头部的「✕」(#olClose / #sbClose) 负责收起。
//
// 断言用 elementFromPoint（等价于「手指点下去命中了谁」），
// 比断言 z-index 数值更贴近真实故障。
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

// 元素中心点上「命中的元素」是谁（返回最近的带 id 祖先）
const hitAt = (sel) => `(() => {
  const b = document.querySelector('${sel}');
  if (!b) return 'missing';
  const r = b.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'zero-size';
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!el) return 'none';
  const owner = el.closest('[id]');
  return owner ? owner.id : el.tagName;
})()`;

const isVisible = (sel) => `(() => {
  const b = document.querySelector('${sel}');
  if (!b) return false;
  const r = b.getBoundingClientRect();
  const cs = getComputedStyle(b);
  return cs.display !== 'none' && r.width > 0 && r.height > 0;
})()`;

async function waitCollapsed(page, id, want) {
  await page.waitForFunction(
    ([i, w]) => document.getElementById(i).classList.contains('collapsed') === w,
    [id, want],
    { timeout: 3000 },
  );
  // class 是同步切的，但侧栏有 transition: transform .22s。
  // 不等动画结束就调 elementFromPoint，测到的是「滑动中」的位置（甚至视口外），
  // 会得到 none 这种假阴性。故统一等动画完成。
  await page.waitForTimeout(260);
}

// ---- 窄屏（抽屉模式）：外部按钮隐藏，由侧栏内 ✕ 收起 ----
async function probeNarrow(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto('file://' + HTML);
  await page.waitForTimeout(350);
  const tag = `${width}x${height}`;
  console.log(`\n[${tag}] 窄屏抽屉模式`);

  // 基线：两边收起（窄屏启动时本来就收起，这里显式确保）
  await page.evaluate(() => {
    document.getElementById('outline').classList.add('collapsed');
    document.getElementById('sidebar').classList.add('collapsed');
  });
  await waitCollapsed(page, 'outline', true);
  await waitCollapsed(page, 'sidebar', true);

  check(`${tag} 收起态 #toggleOutline 可见且可点`,
    (await page.evaluate(hitAt('#toggleOutline'))) === 'toggleOutline',
    await page.evaluate(hitAt('#toggleOutline')));
  check(`${tag} 收起态 #toggleSidebar 可见且可点`,
    (await page.evaluate(hitAt('#toggleSidebar'))) === 'toggleSidebar',
    await page.evaluate(hitAt('#toggleSidebar')));

  // 展开大纲
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  check(`${tag} 大纲展开后外部 #toggleOutline 让位（隐藏）`,
    (await page.evaluate(isVisible('#toggleOutline'))) === false);
  check(`${tag} 大纲展开后侧栏内 #olClose 可点`,
    (await page.evaluate(hitAt('#olClose'))) === 'olClose',
    await page.evaluate(hitAt('#olClose')));
  check(`${tag} 大纲展开后侧栏内容 #addZone 仍可点（未被按钮遮挡）`,
    (await page.evaluate(hitAt('#addZone'))) === 'addZone',
    await page.evaluate(hitAt('#addZone')));

  // 用 ✕ 收回
  await page.click('#olClose');
  await waitCollapsed(page, 'outline', true);
  check(`${tag} 大纲可用 ✕ 收回`, true);
  check(`${tag} 收回后外部 #toggleOutline 重新出现`,
    (await page.evaluate(isVisible('#toggleOutline'))) === true);

  // 展开对话栏
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  check(`${tag} 对话栏展开后外部 #toggleSidebar 让位（隐藏）`,
    (await page.evaluate(isVisible('#toggleSidebar'))) === false);
  check(`${tag} 对话栏展开后侧栏内 #sbClose 可点`,
    (await page.evaluate(hitAt('#sbClose'))) === 'sbClose',
    await page.evaluate(hitAt('#sbClose')));
  check(`${tag} 对话栏展开后「⭐ 收藏」仍可点（没被 toggle 遮挡）`,
    (await page.evaluate(hitAt('#openFavorites'))) === 'openFavorites',
    await page.evaluate(hitAt('#openFavorites')));

  await page.click('#sbClose');
  await waitCollapsed(page, 'sidebar', true);
  check(`${tag} 对话栏可用 ✕ 收回`, true);

  // 互斥：窄屏两侧各占 78vw，同时展开必然重叠（共 156vw），
  // 后开的会盖住先开的头部、连 ✕ 都点不到。
  // 故打开一侧应自动收起另一侧 —— 这是抽屉交互的常规行为。
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  check(`${tag} 大纲已展开`, true);
  // 此时大纲展开中，外部 #toggleSidebar 仍可见（它属于右侧栏，未被隐藏）
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  await waitCollapsed(page, 'outline', true);   // 大纲被自动收起
  check(`${tag} 打开对话栏时大纲自动收起（互斥）`, true);

  // 互斥后右侧 ✕ 一定不被左侧遮挡，可正常收回
  check(`${tag} 互斥后 #sbClose 可点`,
    (await page.evaluate(hitAt('#sbClose'))) === 'sbClose',
    await page.evaluate(hitAt('#sbClose')));
  await page.click('#sbClose');
  await waitCollapsed(page, 'sidebar', true);
  check(`${tag} 互斥后右侧可收回`, true);

  // 反向：先开对话栏，再开大纲，对话栏应被收起
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  await waitCollapsed(page, 'sidebar', true);
  check(`${tag} 打开大纲时对话栏自动收起（互斥）`, true);
  check(`${tag} 互斥后 #olClose 可点`,
    (await page.evaluate(hitAt('#olClose'))) === 'olClose',
    await page.evaluate(hitAt('#olClose')));
  await page.click('#olClose');
  await waitCollapsed(page, 'outline', true);
  check(`${tag} 互斥后左侧可收回`, true);

  // 收藏面板打开时（z-index:60 盖住整个侧栏），抽屉 ✕ 仍可点
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  await page.click('#openFavorites');
  await page.waitForTimeout(250);
  const panelOpen = await page.evaluate(() => !document.getElementById('favPanel').hidden);
  check(`${tag} 收藏面板已打开`, panelOpen === true);
  check(`${tag} 收藏面板打开时 #sbClose 仍可点（未被面板遮挡）`,
    (await page.evaluate(hitAt('#sbClose'))) === 'sbClose',
    await page.evaluate(hitAt('#sbClose')));
  await page.click('#sbClose');
  await waitCollapsed(page, 'sidebar', true);
  check(`${tag} 收藏面板下仍能用 ✕ 收起整侧栏`, true);
  await page.evaluate(() => { document.getElementById('favClose')?.click(); });
  await page.waitForTimeout(150);

  await ctx.close();
}

// ---- 桌面（文档流侧栏）：按钮一直可点，不需要抽屉 ✕ ----
async function probeWide(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto('file://' + HTML);
  await page.waitForTimeout(350);
  const tag = `${width}x${height}`;
  console.log(`\n[${tag}] 桌面（对照）`);

  await page.evaluate(() => {
    document.getElementById('outline').classList.add('collapsed');
    document.getElementById('sidebar').classList.add('collapsed');
  });
  await waitCollapsed(page, 'outline', true);
  await waitCollapsed(page, 'sidebar', true);

  check(`${tag} 抽屉 ✕ 在桌面隐藏`,
    (await page.evaluate(isVisible('#olClose'))) === false,
    await page.evaluate(isVisible('#olClose')));

  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', false);
  check(`${tag} 大纲展开后 #toggleOutline 仍可点（不隐藏）`,
    (await page.evaluate(hitAt('#toggleOutline'))) === 'toggleOutline',
    await page.evaluate(hitAt('#toggleOutline')));
  await page.click('#toggleOutline');
  await waitCollapsed(page, 'outline', true);
  check(`${tag} 大纲可收回`, true);

  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', false);
  check(`${tag} 对话栏展开后 #toggleSidebar 仍可点`,
    (await page.evaluate(hitAt('#toggleSidebar'))) === 'toggleSidebar',
    await page.evaluate(hitAt('#toggleSidebar')));
  check(`${tag} 对话栏展开后「⭐ 收藏」仍可点`,
    (await page.evaluate(hitAt('#openFavorites'))) === 'openFavorites',
    await page.evaluate(hitAt('#openFavorites')));
  await page.click('#toggleSidebar');
  await waitCollapsed(page, 'sidebar', true);
  check(`${tag} 对话栏可收回`, true);

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // 事故现场：平板宽度
  await probeNarrow(browser, 900, 700);
  // 更窄：手机竖屏（平移方案在这里撞车的宽度）
  await probeNarrow(browser, 420, 820);
  // 临界宽度
  await probeNarrow(browser, 1024, 768);
  // 桌面：对照，保证没有回归
  await probeWide(browser, 1280, 800);

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
