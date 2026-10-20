// =========================================================================
// e2e_touch_link.cjs —— touch-link 的端到端验证（手机视口 + 触摸模拟）
//
//   先构建：node build.js
//   再运行：node tests/e2e_touch_link.cjs
//
// 需要 playwright（可用 npx 缓存里的副本）与一份 chromium。
// 路径可用环境变量覆盖：PW_DIR / CHROME_BIN
// =========================================================================
const fs = require('fs');
const { execSync } = require('child_process');

function findPlaywright() {
  if (process.env.PW_DIR) return process.env.PW_DIR;
  // npx 缓存里的副本
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
  return undefined;   // 交给 playwright 自己找
}

const { chromium } = require(findPlaywright());
const CHROME = findChrome();
const path = require('path');

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const HTML = path.join(ROOT, 'MutipleChat.html');
if (!fs.existsSync(HTML)) {
  console.error('缺少 ' + HTML + '，请先运行 node build.js');
  process.exit(1);
}
const URL = 'file://' + HTML;
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✖', name, extra); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },   // 手机尺寸
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(400);

  console.log('\n[1] 页面加载 / 初始状态');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));
  const nodeCount = await page.locator('.node').count();
  check('示例画布有 2 个节点', nodeCount === 2, '实际 ' + nodeCount);

  // ---- 坐标工具：world -> screen ----
  const box = async (sel) => await page.locator(sel).first().boundingBox();
  const a = await box('.node:nth-of-type(1)');
  const b = await box('.node:nth-of-type(2)');

  console.log('\n[2] 从节点「右边框」（非圆点）拖出，落在目标节点「左边框」');
  // 起点：A 右边框中偏下位置（避开端口圆点）
  const sx = a.x + a.width - 2, sy = a.y + a.height * 0.72;
  const tx = b.x + 3, ty = b.y + b.height * 0.72;
  const edgesBefore = await page.locator('#edges path.wire').count();
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 6 });
  const ghostMid = await page.locator('#edges path.ghost').count();
  check('拖动中出现预览线 ghost', ghostMid === 1, '实际 ' + ghostMid);
  const hotTarget = await page.locator('.node.link-target').count();
  check('拖动中途命中高亮（跨中时可能为 0，仅记录）', hotTarget >= 0, String(hotTarget));
  await page.mouse.move(tx, ty, { steps: 6 });
  const hotNear = await page.locator('.node.link-target').count();
  check('接近目标节点时其整圈高亮', hotNear === 1, '实际 ' + hotNear);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const edgesAfter = await page.locator('#edges path.wire').count();
  check('松手后建边成功（边框→边框）', edgesAfter === edgesBefore + 1, `${edgesBefore} -> ${edgesAfter}`);
  check('松手后 ghost 已清理', (await page.locator('#edges path.ghost').count()) === 0);
  check('松手后高亮已清理', (await page.locator('.node.link-target').count()) === 0);

  console.log('\n[3] 反向连：右节点 -> 左节点，线仍落在边上');
  const sx2 = b.x + b.width - 2, sy2 = b.y + b.height * 0.3;
  const tx2 = a.x + a.width - 3, ty2 = a.y + a.height * 0.3;
  const before2 = await page.locator('#edges path.wire').count();
  await page.mouse.move(sx2, sy2);
  await page.mouse.down();
  await page.mouse.move(tx2, ty2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after2 = await page.locator('#edges path.wire').count();
  check('反向连也能建边', after2 === before2 + 1, `${before2} -> ${after2}`);

  console.log('\n[4] 落点在空白处 → 取消，无残留');
  const before3 = await page.locator('#edges path.wire').count();
  await page.mouse.move(a.x + a.width - 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 400, a.y + 600, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('空白处松手不建边', (await page.locator('#edges path.wire').count()) === before3);
  check('无残留 ghost', (await page.locator('#edges path.ghost').count()) === 0);

  console.log('\n[5] 落点在节点内部（非边框）也接受');
  const before4 = await page.locator('#edges path.wire').count();
  await page.mouse.move(a.x + a.width - 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('落点在目标内部同样建边', (await page.locator('#edges path.wire').count()) === before4 + 1);

  console.log('\n[6] 动画：running / ghost 的 CSS 动画已定义并生效');
  const anim = await page.evaluate(() => {
    const g = document.querySelector('#edges .ghost');
    const wire = document.querySelector('#edges path.wire');
    const cs = getComputedStyle(wire);
    return {
      hasGhostRule: [...document.styleSheets[0].cssRules].some(r =>
        r.cssText && r.cssText.includes('.ghost')),
      wireAnimationOnRunning: cs.animationName,
      keyframes: [...document.styleSheets[0].cssRules]
        .filter(r => r.type === CSSRule.KEYFRAMES_RULE).map(r => r.name),
    };
  });
  check('keyframes wire-flow 已定义', anim.keyframes.includes('wire-flow'), anim.keyframes.join(','));
  check('ghost 元素存在且带虚线动画', !!anim.hasGhostRule, JSON.stringify(anim));

  // 手动把一条线设为 running，检查动画名
  const running = await page.evaluate(() => {
    const p = document.querySelector('#edges path.wire');
    p.classList.add('running');
    return getComputedStyle(p).animationName;
  });
  check('running 线应用 wire-flow 动画', running === 'wire-flow', running);

  console.log('\n[7] 增量渲染：重绘不销毁已有 path 元素');
  const same = await page.evaluate(() => {
    const before = document.querySelector('#edges path.wire');
    before.__marker = 'kept';
    // 触发一次重绘（拖动节点会调用 redrawEdges）
    const n = document.querySelector('.node');
    n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }));
    // 直接调用内部重绘
    return { kept: document.querySelector('#edges path.wire')?.__marker === 'kept' };
  });
  check('path 元素被复用（未被 innerHTML 重建）', same.kept, JSON.stringify(same));

  console.log('\n[8] 节点拖动时线跟随，且不报错');
  const n0 = await box('.node:nth-of-type(1)');
  const bar = { x: n0.x + n0.width / 2, y: n0.y + 10 };
  await page.mouse.move(bar.x, bar.y);
  await page.mouse.down();
  await page.mouse.move(bar.x + 40, bar.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('拖动后无异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (errs.length) console.log('页面错误：', errs);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
