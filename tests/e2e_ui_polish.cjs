// =========================================================================
// e2e_ui_polish.cjs —— ui-polish 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_ui_polish.cjs
//
// 覆盖：① 图标不再依赖 Emoji（无豆腐块字符）② token 生效
//      ③ 工具栏分组与主次层级 ④ 空画布引导 ⑤ 快捷键（Delete/方向键/Esc/Ctrl+0）
//      ⑥ 连线命令 placeholder 新文案 ⑦ 对话侧栏空态 chip
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

// 会渲染成豆腐块/彩色 Emoji 的码位区间（截图实测有问题的那批）
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForTimeout(600);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 界面文案里不再有 Emoji/符号图标');
  const emojisInUi = await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'u');
    const els = [...document.querySelectorAll('#toolbar *, .ol-tabs *, .sb-head *, .viewctl *, #viewctl *')];
    const bad = [];
    for (const el of els) {
      if (el.children.length) continue;               // 只看叶子节点文本
      const t = (el.textContent || '').trim();
      if (t && re.test(t)) bad.push(t);
    }
    return bad;
  }, EMOJI_RE.source);
  check('工具栏/侧栏/视图控件无 Emoji 图标', emojisInUi.length === 0, emojisInUi.join(' | '));

  const iconMask = await page.evaluate(() => {
    const ic = document.querySelector('#toolbar .ic');
    if (!ic) return null;
    const cs = getComputedStyle(ic);
    return {
      w: ic.getBoundingClientRect().width,
      mask: cs.maskImage || cs.webkitMaskImage || '',
    };
  });
  check('存在 .ic 图标元素', !!iconMask);
  check('.ic 有实际宽度（>0）', !!iconMask && iconMask.w > 0, JSON.stringify(iconMask));
  check('.ic 使用 mask-image 绘制（不依赖字体）',
        !!iconMask && /url\(/.test(iconMask.mask), JSON.stringify(iconMask));

  console.log('\n[3] 设计 token 生效');
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const pick = k => cs.getPropertyValue(k).trim();
    return {
      ink: pick('--ink'), line: pick('--line'), sh2: pick('--sh-2'),
      r2: pick('--r-2'), danger: pick('--danger'),
    };
  });
  for (const [k, v] of Object.entries(tokens)) check(`token ${k} 已定义`, !!v, k + '=' + v);

  console.log('\n[4] 工具栏分组 + 主操作层级');
  const toolbar = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const seps = tb.querySelectorAll('.tb-sep').length;
    const runSel = document.getElementById('runSel');
    const bg = getComputedStyle(runSel).backgroundColor;
    const doc = getComputedStyle(document.getElementById('addDoc')).backgroundColor;
    return { seps, runBg: bg, docBg: doc };
  });
  check('工具栏存在分隔线', toolbar.seps >= 2, 'seps=' + toolbar.seps);
  check('「运行选中」是实心主按钮', toolbar.runBg !== toolbar.docBg,
        JSON.stringify(toolbar));

  console.log('\n[5] 空画布引导');
  const empty = await page.evaluate(() => {
    clearCanvas();
    HOST.syncEmptyHint();
    const el = document.getElementById('emptyHint');
    const cs = getComputedStyle(el);
    return {
      exists: !!el,
      visible: cs.display !== 'none' && el.offsetParent !== null,
      pe: cs.pointerEvents,
      hasBtn: !!el.querySelector('button'),
    };
  });
  check('#emptyHint 存在', empty.exists);
  check('空画布时可见', empty.visible);
  check('空态层不拦截画布拖动', empty.pe === 'none', empty.pe);
  check('空态层带新建按钮', empty.hasBtn);

  const emptyGone = await page.evaluate(() => {
    createNode('doc', { x: 100, y: 100 });
    HOST.syncEmptyHint();
    const el = document.getElementById('emptyHint');
    return getComputedStyle(el).display === 'none' || el.offsetParent === null;
  });
  check('创建节点后空态隐藏', emptyGone === true);

  console.log('\n[6] 画布快捷键');
  const del = await page.evaluate(() => {
    clearCanvas();
    HOST.syncEmptyHint();
    const a = createNode('doc', { x: 100, y: 100 });
    const b = createNode('doc', { x: 400, y: 100 });
    createEdge(a.id, b.id);
    selectNode(a.id);
    return { before: Object.keys(state.nodes).length, beforeEdges: Object.keys(state.edges).length, id: a.id };
  });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(80);
  const afterDel = await page.evaluate(() => ({
    n: Object.keys(state.nodes).length,
    e: Object.keys(state.edges).length,
    sel: state.selectedNodeId,
  }));
  check('Delete 删除选中节点', afterDel.n === del.before - 1, JSON.stringify(afterDel));
  check('Delete 同时删除其连线', afterDel.e === 0, JSON.stringify(afterDel));
  check('删除后清空选中', afterDel.sel === null, String(afterDel.sel));

  const nudge = await page.evaluate(async () => {
    clearCanvas();
    const a = createNode('doc', { x: 100, y: 100 });
    selectNode(a.id);
    return { x: a.x, y: a.y, id: a.id };
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(60);
  const nudge1 = await page.evaluate(id => ({ x: state.nodes[id].x }), nudge.id);
  check('方向键移动 1px', nudge1.x === nudge.x + 1, JSON.stringify(nudge1));

  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(60);
  const nudge2 = await page.evaluate(id => ({ x: state.nodes[id].x }), nudge.id);
  check('Shift+方向键移动 10px', nudge2.x === nudge.x + 11, JSON.stringify(nudge2));

  const esc = await page.evaluate((id) => {
    selectNode(id);
    return state.selectedNodeId;
  }, nudge.id);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  const afterEsc = await page.evaluate(() => state.selectedNodeId);
  check('Esc 取消选中', esc === nudge.id && afterEsc === null, String(afterEsc));

  const zoom = await page.evaluate(() => {
    view.scale = 0.37; applyView();
    return view.scale;
  });
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(80);
  const afterZoom = await page.evaluate(() => view.scale);
  check('Ctrl+0 回到 100%', Math.abs(afterZoom - 1) < 1e-6, `${zoom} -> ${afterZoom}`);

  const inInput = await page.evaluate(() => {
    clearCanvas();
    const a = createNode('doc', { x: 100, y: 100 });
    selectNode(a.id);
    const ta = document.querySelector('#node-' + a.id + ' textarea');
    if (ta) ta.focus();
    return { id: a.id, focused: document.activeElement.tagName };
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(60);
  const afterInInput = await page.evaluate(() => Object.keys(state.nodes).length);
  check('输入框内 Backspace 不删节点', afterInInput === 1, String(afterInInput));

  console.log('\n[7] 连线命令标签文案');
  const label = await page.evaluate(() => {
    clearCanvas();
    const a = createNode('doc', { x: 100, y: 100 });
    const b = createNode('doc', { x: 400, y: 300 });
    const e = createEdge(a.id, b.id);
    redrawEdges();
    const el = state.edges[e.id].labelEl;
    return { text: el.textContent, title: el.getAttribute('title') || '', placeholder: el.classList.contains('placeholder') };
  });
  check('空命令标签不再是「+ 命令」', !/^\+\s*命令/.test(label.text), label.text);
  check('空命令标签文案可读（含「命令」）', /命令/.test(label.text), label.text);
  check('保留 .placeholder 类（样式/测试依赖）', label.placeholder === true);
  check('有 title 提示如何编辑', !!label.title, label.title);

  console.log('\n[8] 对话侧栏空态示例 chip');
  const chatEmpty = await page.evaluate(() => {
    clearChat();
    const box = document.getElementById('chatEmpty');
    return {
      exists: !!box,
      visible: getComputedStyle(box).display !== 'none',
      chips: box.querySelectorAll('[data-fill]').length,
    };
  });
  check('存在对话空态容器', chatEmpty.exists);
  check('空态可见', chatEmpty.visible);
  check('提供示例问句 chip', chatEmpty.chips >= 2, String(chatEmpty.chips));

  const chipFill = await page.evaluate(() => {
    const chip = document.querySelector('#chatEmpty [data-fill]');
    chip.click();
    return {
      val: document.getElementById('chatInput').value,
      stillEmpty: document.querySelectorAll('#msgs .msg').length === 0,
    };
  });
  check('点击 chip 填入输入框', chipFill.val.length > 0, JSON.stringify(chipFill));
  check('点击 chip 不自动发送', chipFill.stillEmpty);

  console.log('\n[9] 选中节点有次要标记');
  const selMark = await page.evaluate(() => {
    clearCanvas();
    const a = createNode('doc', { x: 100, y: 100 });
    selectNode(a.id);
    const before = getComputedStyle(a.el, '::before').width;
    selectNode(null);
    const after = getComputedStyle(a.el, '::before').width;
    return { before, after };
  });
  check('选中时节点左侧有 accent 竖条', selMark.before !== 'auto' && selMark.before !== '', JSON.stringify(selMark));

  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
