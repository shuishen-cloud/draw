// =========================================================================
// e2e_port_clash.cjs —— port-class-clash 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_port_clash.cjs
//
// 防回归：
//   - 端口尺寸必须为 18×18（class="port out" 曾撞上 .node .out 被撑成 298px）
//   - 整页不得出现水平滚动条（折叠侧栏的溢出曾在 #stage 透传到 html）
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
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 端口尺寸正确（回归：曾被 .node .out 撑成 298px）');
  const ports = await page.evaluate(() => {
    return [...document.querySelectorAll('.node .port')].map(p => ({
      cls: p.className,
      w: p.offsetWidth,
      h: p.offsetHeight,
      position: getComputedStyle(p).position,
    }));
  });
  check('存在端口元素', ports.length >= 2, 'count=' + ports.length);
  const sizesOk = ports.every(p => p.w === 18 && p.h === 18);
  check('所有端口尺寸为 18×18', sizesOk,
        ports.map(p => `${p.cls}:${p.w}x${p.h}`).join(', '));
  const posOk = ports.every(p => p.position === 'absolute');
  check('端口仍为绝对定位', posOk, ports.map(p => p.position).join(','));
  const noBareClass = ports.every(p => !/(^|\s)(in|out)(\s|$)/.test(p.cls));
  check('端口 class 不含裸 in/out（防回归）', noBareClass,
        ports.map(p => p.cls).join(' | '));

  console.log('\n[3] 端口贴边定位正确');
  const sided = await page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll('.node')) {
      const pin = n.querySelector('.port-in');
      const pout = n.querySelector('.port-out');
      if (pin) out.push({ kind: 'in', left: getComputedStyle(pin).left });
      if (pout) out.push({ kind: 'out', right: getComputedStyle(pout).right });
    }
    return out;
  });
  check('.port-in 靠左（left 负值）',
        sided.filter(s => s.kind === 'in').every(s => parseFloat(s.left) < 0),
        JSON.stringify(sided.filter(s => s.kind === 'in')));
  check('.port-out 靠右（right 负值）',
        sided.filter(s => s.kind === 'out').every(s => parseFloat(s.right) < 0),
        JSON.stringify(sided.filter(s => s.kind === 'out')));

  console.log('\n[4] 无整页水平滚动条');
  const scroll = await page.evaluate(() => ({
    htmlScrollW: document.documentElement.scrollWidth,
    htmlClientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
    stageOverflowX: getComputedStyle(document.getElementById('stage')).overflowX,
  }));
  check('documentElement 无水平溢出',
        scroll.htmlScrollW <= scroll.htmlClientW,
        `${scroll.htmlScrollW} vs ${scroll.htmlClientW}`);
  check('#stage overflow-x 为 hidden',
        scroll.stageOverflowX === 'hidden', scroll.stageOverflowX);

  console.log('\n[5] 折叠侧栏后依然无水平滚动（回归场景）');
  await page.evaluate(() => {
    document.getElementById('outline').classList.add('collapsed');
    document.getElementById('sidebar').classList.add('collapsed');
  });
  await page.waitForTimeout(350);
  const collapsed = await page.evaluate(() => ({
    htmlScrollW: document.documentElement.scrollWidth,
    htmlClientW: document.documentElement.clientWidth,
    hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check('折叠两侧栏后无水平滚动', collapsed.hasHScroll === false,
        JSON.stringify(collapsed));

  console.log('\n[6] 节点内不再有多余水平溢出');
  const nodeOverflow = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.node .body, .node textarea, .node .out, .node .md-view')) {
      // 内容区允许 scrollHeight 溢出（纵向滚动），但不允许横向撑宽自身宽度
      const cs = getComputedStyle(el);
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto') {
        bad.push(el.className + ` ${el.clientWidth}/${el.scrollWidth}`);
      }
    }
    return bad;
  });
  check('内容区无未声明的横向溢出', nodeOverflow.length === 0, nodeOverflow.join(' | '));

  console.log('\n[7] 端口仍可拖出连线（功能未受影响）');
  const linkTest = await page.evaluate(() => {
    const n = Object.values(state.nodes)[0];
    const before = Object.keys(state.edges).length;
    addEdge(n.id, Object.values(state.nodes)[1]?.id || n.id);
    return { before, after: Object.keys(state.edges).length };
  });
  check('addEdge 正常工作', linkTest.after === linkTest.before + 1,
        JSON.stringify(linkTest));

  console.log('\n[8] Markdown 预览不受影响');
  const md = await page.evaluate(() => {
    const n = Object.values(state.nodes).find(x => x.kind !== 'img');
    if (!n) return { ok: false, reason: 'no node' };
    if (n.textEl) { n.textEl.value = '# T\n\n**b**'; }
    n.text = '# T\n\n**b**';
    setNodeMode(n, 'preview');
    const v = n.el.querySelector('.md-view');
    return {
      ok: true,
      h1: v.querySelectorAll('h1').length,
      strong: v.querySelectorAll('strong').length,
      h: v.offsetHeight,
      w: v.offsetWidth,
    };
  });
  check('预览渲染 h1', md.h1 === 1, JSON.stringify(md));
  check('预览渲染 strong', md.strong === 1, JSON.stringify(md));
  check('预览区宽度正常（未被端口撑宽）', md.w <= 400, String(md.w));

  console.log('\n[9] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
