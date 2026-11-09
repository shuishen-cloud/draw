// =========================================================================
// e2e_multi_canvas.cjs —— multi-canvas 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_multi_canvas.cjs
//
// 覆盖：初始单画布 / 新建后为空 / 切回能恢复 / 重命名持久化 /
//       删除当前画布后自动回落 / 无 JS 异常。
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('file://' + HTML);
  await page.waitForTimeout(400);

  console.log('\n[1] 初始状态');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  const init = await page.evaluate(() => ({
    hasPicker: !!document.getElementById('canvasPicker'),
    hasMenu: !!document.getElementById('canvasMenu'),
    options: [...(document.getElementById('canvasPicker')?.options || [])].length,
    nodes: Object.keys(state.nodes).length,
    active: activeCanvasId(),
  }));
  check('工具栏有 #canvasPicker', init.hasPicker);
  check('工具栏有 #canvasMenu', init.hasMenu);
  check('初始至少一张画布', init.options >= 1, 'options=' + init.options);
  check('有 activeCanvasId', !!init.active, init.active);
  check('首屏有示例节点（说明画布已载入）', init.nodes > 0, 'nodes=' + init.nodes);

  console.log('\n[2] 新建画布 → 空画布，旧图落盘');
  const before = await page.evaluate(() => {
    window.__firstId = activeCanvasId();
    window.__firstNodes = Object.keys(state.nodes).length;
    createCanvas('第二张');
    return {
      firstId: window.__firstId,
      firstNodes: window.__firstNodes,
      active: activeCanvasId(),
      nodes: Object.keys(state.nodes).length,
      options: document.getElementById('canvasPicker').options.length,
    };
  });
  check('active 已切到新画布', before.active !== before.firstId, JSON.stringify(before));
  check('新画布为空', before.nodes === 0, 'nodes=' + before.nodes);
  check('选择器多了一项', before.options === 2, 'options=' + before.options);

  console.log('\n[3] 切回第一张');
  const back = await page.evaluate(() => {
    switchCanvas(window.__firstId);
    return { nodes: Object.keys(state.nodes).length, active: activeCanvasId() };
  });
  check('切回后节点恢复', back.nodes === before.firstNodes, `${back.nodes} vs ${before.firstNodes}`);
  check('active 指向第一张', back.active === before.firstId);

  console.log('\n[4] 重命名并刷新页面');
  const renamed = await page.evaluate(() => {
    renameCanvas(window.__firstId, '方案A');
    const sel = document.getElementById('canvasPicker');
    const opt = [...sel.options].find(o => o.value === window.__firstId);
    return { text: opt?.textContent || '', flush: flushCanvas() };
  });
  check('选择器文字已更新', renamed.text === '方案A', renamed.text);

  await page.reload();
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => {
    const sel = document.getElementById('canvasPicker');
    return {
      names: [...sel.options].map(o => o.textContent),
      options: sel.options.length,
      nodes: Object.keys(state.nodes).length,
    };
  });
  check('刷新后画布数量保持', afterReload.options === 2, JSON.stringify(afterReload));
  check('刷新后名字持久化', afterReload.names.includes('方案A'), JSON.stringify(afterReload.names));
  check('刷新后仍载入当前画布内容', afterReload.nodes > 0, 'nodes=' + afterReload.nodes);

  console.log('\n[5] 删除当前画布 → 自动回落');
  const afterRemove = await page.evaluate(() => {
    const cur = activeCanvasId();
    removeCanvas(cur);
    return {
      active: activeCanvasId(),
      list: listCanvases().length,
      inList: listCanvases().some(c => c.id === cur),
    };
  });
  check('当前画布已从清单移除', afterRemove.inList === false);
  check('active 指向剩余画布', afterRemove.active && afterRemove.active !== undefined);
  check('剩余至少一张', afterRemove.list >= 1, 'list=' + afterRemove.list);

  console.log('\n[6] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n合计 ${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
