// =========================================================================
// e2e_node_scroll.cjs —— node-scroll 的端到端验证（手机视口）
//
//   先构建：node build.js
//   再运行：node tests/e2e_node_scroll.cjs
//
// 断言：节点高度不被内容压扁/撑大、.body 成为约束边界、
//       内容区可独立滚动、滚动到底不透传到画布。
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
const URL = 'file://' + HTML;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✖', name, extra); }
}
function near(a, b, tol = 2) { return Math.abs(a - b) <= tol; }

const LONG = '这是一行比较长的内容，用来测试滚动栏是否正常工作。\n';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(400);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  // 清空示例画布，建立测试用四种节点
  const setup = await page.evaluate(() => {
    clearCanvas();
    const doc = createNode('doc', { x: 40, y: 40, w: 300, h: 200 });
    const out = createNode('output', { x: 40, y: 280, w: 300, h: 200 });
    const exec = createNode('exec', { x: 40, y: 520, w: 320, h: 260 });
    const img = createNode('img', { x: 400, y: 40, w: 240, h: 200 });
    // 本套测试考察「编辑态」的滚动行为；节点默认是预览态，显式切回。
    for (const n of [doc, out, exec]) setNodeMode(n, 'edit');
    applyView();
    return { doc: doc.id, out: out.id, exec: exec.id, img: img.id };
  });

  console.log('\n[2] doc 节点：长文本不压扁节点、能独立滚动');
  const doc = await page.evaluate((id) => {
    const n = state.nodes[id];
    const S = view.scale;   // 屏幕像素 -> world 单位
    const ta = n.el.querySelector('textarea');
    ta.value = '这是一行比较长的内容，用来测试滚动栏是否正常工作。\n'.repeat(120);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const body = n.el.querySelector('.body');
    const nRect = n.el.getBoundingClientRect();
    const bRect = body.getBoundingClientRect();
    const bar = n.el.querySelector('.bar').getBoundingClientRect();
    const taCS = getComputedStyle(ta);
    return {
      scale: S,
      configuredH: n.h,
      nodeH: nRect.height / S,
      bodyH: bRect.height / S,
      barH: bar.height / S,
      bodyOverflow: getComputedStyle(body).overflow,
      taScrollH: ta.scrollHeight,
      taClientH: ta.clientHeight,
      taOverflowY: taCS.overflowY,
      overscroll: taCS.overscrollBehaviorY,
    };
  }, setup.doc);
  check('节点高度 == 配置值 h（未被内容压扁/撑大）',
        near(doc.nodeH, doc.configuredH, 2), `${doc.nodeH} vs ${doc.configuredH}`);
  check('.body 高度 == 节点高 − 标题栏高',
        near(doc.bodyH, doc.nodeH - doc.barH, 3), `${doc.bodyH} vs ${doc.nodeH - doc.barH}`);
  check('.body overflow 为 hidden（内容不溢出节点）',
        doc.bodyOverflow === 'hidden', doc.bodyOverflow);
  check('textarea 有独立滚动（scrollHeight > clientHeight）',
        doc.taScrollH > doc.taClientH, `${doc.taScrollH} > ${doc.taClientH}`);
  check('textarea overflow-y 为 auto', doc.taOverflowY === 'auto', doc.taOverflowY);
  check('textarea 设置 overscroll-behavior: contain',
        doc.overscroll === 'contain', doc.overscroll);

  console.log('\n[3] doc 节点：真的能滚');
  const scrolled = await page.evaluate((id) => {
    const ta = state.nodes[id].el.querySelector('textarea');
    ta.scrollTop = 200;
    return { scrollTop: ta.scrollTop, maxScroll: ta.scrollHeight - ta.clientHeight };
  }, setup.doc);
  check('设置 scrollTop 后生效', scrolled.scrollTop > 0, JSON.stringify(scrolled));
  check('可滚动范围合理', scrolled.maxScroll > 0, JSON.stringify(scrolled));

  console.log('\n[4] output 节点：结果区滚动');
  const out = await page.evaluate((id) => {
    const n = state.nodes[id];
    const S = view.scale;
    const el = n.el.querySelector('.out');
    el.textContent = '输出结果行\n'.repeat(100);
    n.text = el.textContent;
    const nRect = n.el.getBoundingClientRect();
    const bar = n.el.querySelector('.bar').getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      configuredH: n.h,
      nodeH: nRect.height / S,
      barH: bar.height / S,
      outH: el.getBoundingClientRect().height / S,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      overflowY: cs.overflowY, minH: cs.minHeight,
    };
  }, setup.out);
  check('output 节点高度 == 配置值', near(out.nodeH, out.configuredH, 2),
        `${out.nodeH} vs ${out.configuredH}`);
  check('结果区有独立滚动', out.scrollH > out.clientH, `${out.scrollH} > ${out.clientH}`);
  check('结果区 overflow-y auto', out.overflowY === 'auto', out.overflowY);
  check('结果区高度占满 body', near(out.outH, out.nodeH - out.barH, 3),
        `${out.outH} vs ${out.nodeH - out.barH}`);

  console.log('\n[5] exec 节点：提示词固定、结果区可滚');
  const ex = await page.evaluate((id) => {
    const n = state.nodes[id];
    const S = view.scale;
    const prompt = n.el.querySelector('.exec-prompt');
    const res = n.el.querySelector('.exec-out');
    res.textContent = '执行结果行\n'.repeat(80);
    const nRect = n.el.getBoundingClientRect();
    const bar = n.el.querySelector('.bar').getBoundingClientRect();
    return {
      configuredH: n.h,
      nodeH: nRect.height / S,
      barH: bar.height / S,
      promptH: prompt.getBoundingClientRect().height / S,
      promptScrollH: prompt.scrollHeight,
      resH: res.getBoundingClientRect().height,
      resScrollH: res.scrollHeight, resClientH: res.clientHeight,
      resOverflowY: getComputedStyle(res).overflowY,
    };
  }, setup.exec);
  check('exec 节点高度 == 配置值', near(ex.nodeH, ex.configuredH, 2),
        `${ex.nodeH} vs ${ex.configuredH}`);
  check('提示词区固定高度（不随结果增长）', ex.promptH > 0 && ex.promptH < 80,
        String(ex.promptH));
  check('结果区可滚动', ex.resScrollH > ex.resClientH,
        `${ex.resScrollH} > ${ex.resClientH}`);
  check('结果区 overflow-y auto', ex.resOverflowY === 'auto', ex.resOverflowY);

  console.log('\n[6] 图片节点：不出现多余滚动条');
  const img = await page.evaluate((id) => {
    const n = state.nodes[id];
    const body = n.el.querySelector('.body');
    return {
      bodyOverflow: getComputedStyle(body).overflow,
      nodeH: n.el.getBoundingClientRect().height / view.scale,
      configuredH: n.h,
    };
  }, setup.img);
  check('图片节点高度 == 配置值', near(img.nodeH, img.configuredH, 2),
        `${img.nodeH} vs ${img.configuredH}`);
  check('图片节点内容不溢出', img.bodyOverflow === 'hidden', img.bodyOverflow);

  console.log('\n[7] 内容溢出时节点尺寸不变（回归：原 bug 会压到 52px）');
  const regression = await page.evaluate((id) => {
    const n = state.nodes[id];
    const ta = n.el.querySelector('textarea');
    const S = view.scale;
    const before = n.el.getBoundingClientRect().height / S;
    ta.value = 'x\n'.repeat(2000);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const after = n.el.getBoundingClientRect().height / S;
    return { before, after };
  }, setup.doc);
  check('超长内容后节点高度不变',
        near(regression.before, regression.after, 2), JSON.stringify(regression));

  console.log('\n[8] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
