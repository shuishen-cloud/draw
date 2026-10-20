// =========================================================================
// e2e_ux_fixes.cjs —— ux-fixes 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_ux_fixes.cjs
//
// 覆盖：默认预览、示例含 Markdown、分类下拉不误触发选图、
//       #hint 不拦截点击、工具栏可点、1:1 缩放后节点可见。
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

// 用于拦截「文件选择器是否被打开」：替换 input.click 计数
const SPY = `
  window.__filePickCount = 0;
  const origCreate = document.createElement.bind(document);
  document.createElement = function(tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'input') {
      const origClick = el.click.bind(el);
      el.click = function() {
        if (this.type === 'file') window.__filePickCount++;
        return origClick();
      };
    }
    return el;
  };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(SPY);
  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 默认就是预览模式');
  const modes = await page.evaluate(() => {
    return [...document.querySelectorAll('.node')].map(n => ({
      kind: n.dataset.kind,
      mode: n.dataset.mode,
      mdVisible: !n.querySelector('.md-view')?.hidden,
      bodyVisible: !n.querySelector('.body')?.hidden,
      toggle: n.querySelector('.md-toggle')?.textContent || null,
    }));
  });
  const textNodes = modes.filter(m => m.kind !== 'img');
  check('doc/output/exec 默认 mode=preview',
        textNodes.every(m => m.mode === 'preview'),
        JSON.stringify(modes));
  check('.md-view 默认可见',
        textNodes.every(m => m.mdVisible === true),
        JSON.stringify(modes));
  check('.body 默认隐藏',
        textNodes.every(m => m.bodyVisible === false),
        JSON.stringify(modes));
  check('按钮文案为「编辑」（表示可切回编辑）',
        textNodes.every(m => m.toggle === '编辑'),
        JSON.stringify(modes));

  console.log('\n[3] 默认示例含 Markdown 且已渲染');
  const sample = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.node')].find(x => x.dataset.kind === 'doc');
    const v = n.querySelector('.md-view');
    const src = state.nodes[n.id.replace('node-','')]?.text || '';
    return {
      src,
      hasSyntax: /^#{1,6}\s|^\s*[-*+]\s|\*\*/m.test(src),
      h1: v.querySelectorAll('h1').length,
      li: v.querySelectorAll('li').length,
      strong: v.querySelectorAll('strong').length,
      blockquote: v.querySelectorAll('blockquote').length,
    };
  });
  check('示例源文本含 Markdown 语法', sample.hasSyntax, JSON.stringify(sample.src));
  check('渲染出标题', sample.h1 >= 1, String(sample.h1));
  check('渲染出列表', sample.li >= 2, String(sample.li));

  console.log('\n[4] 图片节点：点分类下拉不触发选图');
  const imgTest = await page.evaluate(() => {
    clearCanvas();
    const img = createNode('img', { x: 40, y: 40, w: 240, h: 200 });
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    window.__filePickCount = 0;

    // 点分类下拉
    const pick = img.el.querySelector('.zone-pick');
    pick.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterPick = window.__filePickCount;

    // 点删除按钮 —— 会删节点，放最后测
    return { imgId: img.id, afterPick };
  });
  check('点 .zone-pick 不打开文件选择器', imgTest.afterPick === 0,
        'count=' + imgTest.afterPick);

  const closeTest = await page.evaluate(() => {
    const img = createNode('img', { x: 300, y: 40, w: 200, h: 160 });
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    window.__filePickCount = 0;
    const before = Object.keys(state.nodes).length;
    img.el.querySelector('.close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { before, after: Object.keys(state.nodes).length, picks: window.__filePickCount };
  });
  check('点 .close 不打开文件选择器', closeTest.picks === 0, 'count=' + closeTest.picks);
  check('点 .close 确实删除了节点', closeTest.after === closeTest.before - 1,
        `${closeTest.before} -> ${closeTest.after}`);

  console.log('\n[5] 图片节点内容区点击仍能选图（功能保留）');
  const imgClick = await page.evaluate(() => {
    const img = createNode('img', { x: 40, y: 300, w: 200, h: 160 });
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    window.__filePickCount = 0;
    img.el.querySelector('.body').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return window.__filePickCount;
  });
  check('点击图片内容区会打开文件选择器', imgClick === 1, 'count=' + imgClick);

  console.log('\n[6] #hint 不拦截指针事件');
  const hint = await page.evaluate(() => {
    const h = document.getElementById('hint');
    const cs = getComputedStyle(h);
    return { pointerEvents: cs.pointerEvents, exists: !!h };
  });
  check('#hint 存在', hint.exists);
  check('#hint pointer-events 为 none', hint.pointerEvents === 'none',
        hint.pointerEvents);

  console.log('\n[7] 工具栏按钮可直接点击（不再被遮挡）');
  const toolbarHit = await page.evaluate(() => {
    const ids = ['reset1', 'fit', 'zoomIn', 'zoomOut', 'saveCanvas'];
    const blocked = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const id of ids) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      const r = btn.getBoundingClientRect();
      if (r.width === 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // 被横向滚动挤出可视区的按钮不计：工具栏在窄屏是可横滑的
      if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!(top === btn || btn.contains(top))) {
        blocked.push(id + ' -> ' + (top?.id || top?.className || top?.tagName));
      }
    }
    return blocked;
  });
  check('可视区内的工具栏按钮未被遮挡', toolbarHit.length === 0, toolbarHit.join(' | '));

  console.log('\n[8] 点 1:1 后节点仍在可见区域');
  const zoom = await page.evaluate(() => {
    clearCanvas();
    const n = createNode('doc', { x: 100, y: 120, w: 300, h: 160 });
    view.scale = 0.35; view.x = 20; view.y = 20; applyView();
    document.getElementById('reset1').click();
    const wrap = document.getElementById('canvasWrap').getBoundingClientRect();
    const r = n.el.getBoundingClientRect();
    const visible = r.right > wrap.left && r.left < wrap.right
                 && r.bottom > wrap.top && r.bottom < wrap.bottom
                 && r.left < wrap.right && r.width > 0;
    return {
      scale: view.scale, visible,
      nodeRect: { l: r.left, t: r.top, w: r.width, h: r.height },
      wrapRect: { l: wrap.left, t: wrap.top, w: wrap.width, h: wrap.height },
    };
  });
  check('缩放恢复到 1.0', Math.abs(zoom.scale - 1) < 0.01, String(zoom.scale));
  check('节点仍在可见区域内', zoom.visible, JSON.stringify(zoom));

  console.log('\n[9] 切回编辑再切回预览仍然正常');
  const toggle = await page.evaluate(() => {
    const n = Object.values(state.nodes).find(x => x.kind !== 'img');
    const initial = n.el.dataset.mode;
    setNodeMode(n, 'edit');
    const edit = { mode: n.el.dataset.mode, bodyVisible: !n.el.querySelector('.body').hidden };
    setNodeMode(n, 'preview');
    const prev = { mode: n.el.dataset.mode, mdVisible: !n.el.querySelector('.md-view').hidden };
    return { initial, edit, prev };
  });
  check('默认是 preview', toggle.initial === 'preview', toggle.initial);
  check('切到 edit 后 body 可见', toggle.edit.mode === 'edit' && toggle.edit.bodyVisible,
        JSON.stringify(toggle.edit));
  check('切回 preview 后 md-view 可见',
        toggle.prev.mode === 'preview' && toggle.prev.mdVisible, JSON.stringify(toggle.prev));

  console.log('\n[10] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
