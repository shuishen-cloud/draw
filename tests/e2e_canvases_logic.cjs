// =========================================================================
// e2e_canvases_logic.cjs —— canvases.js 仓库逻辑验证（在真实页面里跑，无需 DOM mock）
//
//   先构建：node build.js
//   再运行：node tests/e2e_canvases_logic.cjs
//
// 为什么不放 node --test：importCanvasData / clearCanvas 会真实操作 DOM 与 SVG，
// 用 jsdom 模拟成本高且与真实浏览器行为有偏差。这里把断言搬进 Playwright 页面，
// 用内存版 storage 注入，覆盖：迁移 / 幂等 / 建空 / create / switch /
// rename / duplicate / remove / 存储超限兜底。
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

// 内存版 storage（注入到 canvases.js）
const MEM = `
  window.__mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return {
      getItem(k) { return m.has(k) ? m.get(k) : null; },
      setItem(k, v) { m.set(k, String(v)); },
      removeItem(k) { m.delete(k); },
      get length() { return m.size; },
      _m: m,
    };
  };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.addScriptTag({ content: MEM });
  await page.waitForTimeout(300);

  const run = (fn, arg) => page.evaluate(fn, arg);

  console.log('\n[1] 迁移：只有旧键 mc_canvas → 「默认画布」，正文不变');
  const mig = await run(() => {
    const oldBody = { format: 'mutiplechat-canvas', version: 1, view: { x: 0, y: 0, scale: 1 },
      nodes: [{ id: 'n1', kind: 'doc', title: '旧图', x: 0, y: 0, w: 100, h: 80, text: 'hi' }],
      edges: [], zones: [], tasks: [] };
    localStorage.clear();
    const s = window.__mem({ mc_canvas: JSON.stringify(oldBody) });
    __setStorage(s);
    ensureRepo();
    const list = listCanvases();
    const id = list[0].id;
    const body = JSON.parse(s.getItem(keyOf(id)));
    ensureRepo();                       // 幂等
    return {
      n: list.length, name: list[0].name, active: activeCanvasId(),
      title: body.nodes[0].title, after: listCanvases().length,
      legacyKept: !!s.getItem('mc_canvas'),
    };
  });
  check('迁移出 1 张画布', mig.n === 1, String(mig.n));
  check('名字为「默认画布」', mig.name === '默认画布', mig.name);
  check('active 指向迁移出的画布', !!mig.active);
  check('正文原样保留', mig.title === '旧图', mig.title);
  check('ensureRepo 幂等', mig.after === 1, String(mig.after));
  check('旧键保留不删（兜底）', mig.legacyKept === true);

  console.log('\n[2] 空仓库 → 自动建空画布');
  const empty = await run(() => {
    localStorage.clear();
    const s = window.__mem();
    __setStorage(s);
    clearCanvas();
    ensureRepo();
    const list = listCanvases();
    return {
      n: list.length, active: activeCanvasId(),
      hasList: !!s.getItem('mc_canvases'),
      nodes: JSON.parse(s.getItem(keyOf(list[0].id))).nodes.length,
    };
  });
  check('自动建 1 张', empty.n === 1, String(empty.n));
  check('写入 active', !!empty.active);
  check('写入清单', empty.hasList);
  check('新画布为空', empty.nodes === 0, String(empty.nodes));

  console.log('\n[3] createCanvas：新画布为空，旧画布已落盘');
  const created = await run(() => {
    localStorage.clear();
    const s = window.__mem();
    __setStorage(s);
    ensureRepo();
    const first = activeCanvasId();
    importCanvasData({ format: 'mutiplechat-canvas', version: 1, view: { x: 0, y: 0, scale: 1 },
      nodes: [{ id: 'n1', kind: 'doc', title: 'A', x: 0, y: 0, w: 100, h: 80, text: '' }],
      edges: [], zones: [], tasks: [] });
    const id2 = createCanvas('第二张');
    return {
      first, id2, active: activeCanvasId(),
      n: listCanvases().length,
      savedFirst: JSON.parse(s.getItem(keyOf(first))).nodes[0]?.title,
      liveNodes: Object.keys(state.nodes).length,
    };
  });
  check('id 唯一', created.id2 !== created.first, JSON.stringify(created));
  check('active 切到新画布', created.active === created.id2);
  check('清单 2 项', created.n === 2, String(created.n));
  check('旧画布内容已落盘', created.savedFirst === 'A', created.savedFirst);
  check('新画布为空白', created.liveNodes === 0, String(created.liveNodes));

  console.log('\n[4] switchCanvas：来回切换各自保留');
  const sw = await run((ids) => {
    switchCanvas(ids.first);
    const a = Object.keys(state.nodes).length > 0
      ? Object.values(state.nodes)[0].title : null;
    switchCanvas(ids.id2);
    const b = Object.keys(state.nodes).length;
    const missing = switchCanvas('不存在');
    return { a, b, missing, active: activeCanvasId() };
  }, { first: created.first, id2: created.id2 });
  check('切回第一张恢复节点', sw.a === 'A', String(sw.a));
  check('切到第二张为空', sw.b === 0, String(sw.b));
  check('切不存在的 id 返回 false', sw.missing === false);
  check('失败时 active 不变', sw.active === created.id2);

  console.log('\n[5] rename / duplicate / remove');
  const ops = await run((ids) => {
    localStorage.clear();
    const s = window.__mem();
    __setStorage(s);
    ensureRepo();
    const a = activeCanvasId();
    importCanvasData({ format: 'mutiplechat-canvas', version: 1, view: { x: 0, y: 0, scale: 1 },
      nodes: [{ id: 'n1', kind: 'doc', title: '原始', x: 0, y: 0, w: 100, h: 80, text: '' }],
      edges: [], zones: [], tasks: [] });

    const ren = renameCanvas(a, '改名后');
    const renName = listCanvases().find(c => c.id === a).name;
    const renBad = renameCanvas('不存在', 'x');

    const copy = duplicateCanvas(a);
    const copyName = listCanvases().find(c => c.id === copy).name;
    // 改副本：切过去 → 改内容 → 落盘（真实用户路径），源画布不应受影响
    switchCanvas(copy);
    importCanvasData({ format: 'mutiplechat-canvas', version: 1, view: { x: 0, y: 0, scale: 1 },
      nodes: [{ id: 'n1', kind: 'doc', title: '改过的副本', x: 0, y: 0, w: 100, h: 80, text: '' }],
      edges: [], zones: [], tasks: [] });
    saveCurrent();
    const copySaved = JSON.parse(s.getItem(keyOf(copy))).nodes[0]?.title;
    switchCanvas(a);
    const srcTitle = Object.values(state.nodes)[0]?.title;

    const removed = removeCanvas(copy);
    const afterRemoveActive = activeCanvasId();
    const copyKeyGone = s.getItem(keyOf(copy)) === null;

    return { ren, renName, renBad, copy, copyName, srcTitle, copySaved,
             removed, afterRemoveActive, copyKeyGone, a,
             n: listCanvases().length };
  }, created);
  check('rename 返回 true', ops.ren === true);
  check('名字已更新', ops.renName === '改名后', ops.renName);
  check('rename 不存在的 id 返回 false', ops.renBad === false);
  check('duplicate 返回新 id', !!ops.copy && ops.copy !== ops.a);
  check('副本名为「X 副本」', ops.copyName === '改名后 副本', ops.copyName);
  check('副本内容已独立落盘', ops.copySaved === '改过的副本', String(ops.copySaved));
  check('改副本不影响源画布', ops.srcTitle === '原始', String(ops.srcTitle));
  check('remove 返回 true', ops.removed === true);
  check('删当前画布后 active 回落', ops.afterRemoveActive === ops.a, ops.afterRemoveActive);
  check('正文键已清除', ops.copyKeyGone === true);

  console.log('\n[6] 删最后一张 → 自动补空画布');
  const last = await run(() => {
    localStorage.clear();
    const s = window.__mem();
    __setStorage(s);
    ensureRepo();
    const only = activeCanvasId();
    removeCanvas(only);
    return { n: listCanvases().length, active: activeCanvasId(),
             same: activeCanvasId() === only, nodes: Object.keys(state.nodes).length };
  });
  check('自动补 1 张', last.n === 1, String(last.n));
  check('active 指向新画布', last.same === false);
  check('新画布为空', last.nodes === 0, String(last.nodes));

  console.log('\n[7] 存储超限兜底：只告警不抛错');
  const quota = await run(() => {
    localStorage.clear();
    const s = window.__mem();
    const realSet = s.setItem.bind(s);
    // 只让「正文键」超限（模拟大图撑爆配额），清单写入必须成功
    s.setItem = (k, v) => {
      if (String(k).startsWith('mc_canvas:') && String(v).length > 50) {
        const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
      }
      return realSet(k, v);
    };
    __setStorage(s);
    let threw = false;
    let warned = 0;
    const origWarn = DBG.warn;
    DBG.warn = (...a) => { warned++; origWarn(...a); };
    try { ensureRepo(); createCanvas('大图'); saveCurrent(); } catch { threw = true; }
    DBG.warn = origWarn;
    return { threw, warned, n: listCanvases().length, active: activeCanvasId() };
  });
  check('超限不抛异常', quota.threw === false);
  check('超限有告警（DBG.warn）', quota.warned > 0, 'warned=' + quota.warned);
  check('仍能拿到画布清单', quota.n >= 1, String(quota.n));
  check('仍能记住当前画布', !!quota.active, String(quota.active));

  console.log('\n[8] 全局');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n合计 ${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
