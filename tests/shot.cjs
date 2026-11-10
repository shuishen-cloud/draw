// 截图工具：node tests/shot.cjs [outDir]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
function findPlaywright() {
  if (process.env.PW_DIR) return process.env.PW_DIR;
  const base = `${process.env.HOME}/.npm/_npx`;
  for (const d of fs.readdirSync(base)) {
    const p = `${base}/${d}/node_modules/playwright`;
    if (fs.existsSync(p)) return p;
  }
  return 'playwright';
}
function findChrome() {
  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  const dir = fs.readdirSync(cache).find(n => /^chromium-\d+$/.test(n));
  return `${cache}/${dir}/chrome`;
}
const { chromium } = require(findPlaywright());
const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const HTML = path.join(ROOT, 'MutipleChat.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const errs = [];
  for (const [name, vp, touch, setup] of [
    ['desktop', { width: 1440, height: 900 }, false, null],
    ['tablet', { width: 820, height: 1180 }, true, null],
    ['phone', { width: 390, height: 844 }, true, null],
    ['empty', { width: 1440, height: 900 }, false, 'clearCanvas(); HOST.syncEmptyHint();'],
    ['selected', { width: 1440, height: 900 }, false,
      "const n=Object.keys(state.nodes)[0]; selectNode(n); const e=Object.keys(state.edges)[0]; if(e) selectEdge(e);"],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
    await page.goto('file://' + HTML);
    await page.waitForTimeout(700);
    if (setup) { await page.evaluate(setup); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }
  await browser.close();
  if (errs.length) console.log('ERR:', errs.join('\n'));
  else console.log('ok, shots at', OUT);
})();
