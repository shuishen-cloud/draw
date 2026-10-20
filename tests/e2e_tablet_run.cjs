// =========================================================================
// e2e_tablet_run.cjs —— tablet-run-naming 的端到端验证（平板视口 + 触摸）
//
//   先构建：node build.js
//   再运行：node tests/e2e_tablet_run.cjs
//
// 覆盖：卡片命名（双击编辑/Enter 保存/Esc 取消/空名回退）、
//       执行节点 ▶ 按钮、工具栏「运行选中」、runAll 进度与取消。
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

// 拦截网络：模拟 LLM 流式响应，避免真实调用
const STUB_FETCH = `
  window.__fetchCalls = [];
  window.__fetchDelay = 0;
  const realFetch = window.fetch;
  window.fetch = async function(url, opts) {
    const u = String(url);
    window.__fetchCalls.push(u);
    const delay = window.__fetchDelay;
    // 构造一个极简 SSE 流
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(ctrl) {
        await new Promise(r => setTimeout(r, delay));
        ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\\n\\n'));
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        ctrl.enqueue(enc.encode('data: [DONE]\\n\\n'));
        ctrl.close();
      }
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('file://' + HTML);
  await page.waitForTimeout(600);
  await page.addScriptTag({ content: STUB_FETCH });

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  // 统一准备画布
  await page.evaluate(() => {
    clearCanvas();
    document.getElementById('apiKey').value = 'test-key';
  });

  console.log('\n[2] 卡片命名：双击进入编辑');
  const edit = await page.evaluate(() => {
    const n = createNode('doc', { x: 40, y: 40, w: 280, h: 160, text: '# A' });
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    const t = n.el.querySelector('.title');
    const before = { text: t.textContent, editable: t.isContentEditable };
    t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return {
      id: n.id, before,
      after: { editable: t.isContentEditable, focused: document.activeElement === t },
      oldTitle: n.title,
    };
  });
  check('初始标题不可编辑', edit.before.editable === false, String(edit.before.editable));
  check('初始标题为「文档」', edit.before.text === '文档', edit.before.text);
  check('双击后进入编辑态', edit.after.editable === true, String(edit.after.editable));
  check('双击后自动聚焦', edit.after.focused === true, String(edit.after.focused));

  console.log('\n[3] 输入新名字 + Enter 保存');
  const rename = await page.evaluate((id) => {
    const n = state.nodes[id];
    const t = n.el.querySelector('.title');
    t.textContent = '我的第一份文档';
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return {
      title: n.title,
      domTitle: t.textContent,
      editable: t.isContentEditable,
    };
  }, edit.id);
  check('node.title 更新', rename.title === '我的第一份文档', rename.title);
  check('DOM 标题同步', rename.domTitle === '我的第一份文档', rename.domTitle);
  check('Enter 后退出编辑态', rename.editable === false, String(rename.editable));

  console.log('\n[4] Esc 取消编辑');
  const esc = await page.evaluate((id) => {
    const n = state.nodes[id];
    const t = n.el.querySelector('.title');
    t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    t.textContent = '临时改动';
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { title: n.title, domTitle: t.textContent, editable: t.isContentEditable };
  }, edit.id);
  check('Esc 后标题不变', esc.title === '我的第一份文档', esc.title);
  check('Esc 后 DOM 标题回滚', esc.domTitle === '我的第一份文档', esc.domTitle);
  check('Esc 后退出编辑态', esc.editable === false, String(esc.editable));

  console.log('\n[5] 空标题失焦回退默认名');
  const empty = await page.evaluate((id) => {
    const n = state.nodes[id];
    const t = n.el.querySelector('.title');
    t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    t.textContent = '   ';
    t.dispatchEvent(new FocusEvent('blur'));
    t.blur?.();
    return { title: n.title, domTitle: t.textContent };
  }, edit.id);
  check('空标题回退「文档」', empty.title === '文档', empty.title);
  check('DOM 同步回退', empty.domTitle === '文档', empty.domTitle);

  console.log('\n[6] 重命名持久化到导出数据');
  const persist = await page.evaluate((id) => {
    renameNode(state.nodes[id], '重命名后');
    const d = exportCanvasData();
    return { title: d.nodes.find(x => x.id === id)?.title };
  }, edit.id);
  check('导出数据含新名字', persist.title === '重命名后', String(persist.title));

  console.log('\n[7] 执行节点有 ▶ 运行按钮（触摸入口）');
  const execBtn = await page.evaluate(() => {
    clearCanvas();
    const ex = createNode('exec', { x: 40, y: 40, w: 320, h: 240 });
    ex.prompt = '总结';
    ex.promptEl.value = '总结';
    const src = createNode('doc', { x: 40, y: 340, w: 260, h: 140, text: '内容' });
    addEdge(src.id, ex.id);
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    const btn = ex.el.querySelector('.run-node');
    return {
      execId: ex.id,
      exists: !!btn,
      text: btn?.textContent,
      title: btn?.title,
      isButton: btn?.tagName === 'BUTTON',
    };
  });
  check('执行节点有运行按钮', execBtn.exists === true, JSON.stringify(execBtn));
  check('按钮是 <button>（触摸可点）', execBtn.isButton === true, String(execBtn.isButton));

  const clickRun = await page.evaluate(async (id) => {
    window.__fetchCalls = [];
    const n = state.nodes[id];
    n.el.querySelector('.run-node').click();
    await new Promise(r => setTimeout(r, 400));
    return { calls: window.__fetchCalls.length, text: n.text };
  }, execBtn.execId);
  check('点 ▶ 触发了请求', clickRun.calls >= 1, 'calls=' + clickRun.calls);
  check('执行结果写入节点', typeof clickRun.text === 'string', String(clickRun.text));

  console.log('\n[8] 工具栏「运行选中」按钮');
  const toolbar = await page.evaluate(() => {
    const b = document.getElementById('runSel');
    return { exists: !!b, text: b?.textContent?.trim() };
  });
  check('工具栏有「运行选中」', toolbar.exists === true, JSON.stringify(toolbar));

  const runSel = await page.evaluate(async () => {
    clearCanvas();
    const a = createNode('doc', { x: 40, y: 40, w: 240, h: 120, text: '源' });
    const b = createNode('output', { x: 400, y: 40, w: 240, h: 120 });
    const e = addEdge(a.id, b.id);
    e.command = '🖐️处理';
    layoutEdgeLabel(e);
    state.selectedEdgeId = e.id;
    redrawEdges();
    window.__fetchCalls = [];
    document.getElementById('runSel').click();
    await new Promise(r => setTimeout(r, 400));
    return { calls: window.__fetchCalls.length, out: b.text };
  });
  check('运行选中连线会发起请求', runSel.calls >= 1, 'calls=' + runSel.calls);

  console.log('\n[9] runAll 进度上报与取消');
  const progress = await page.evaluate(async () => {
    clearCanvas();
    const a = createNode('doc', { x: 40, y: 40, w: 240, h: 120, text: 'A' });
    const b = createNode('output', { x: 400, y: 40, w: 240, h: 120 });
    const e1 = addEdge(a.id, b.id); e1.command = '🖐️一'; layoutEdgeLabel(e1);
    const c = createNode('doc', { x: 40, y: 220, w: 240, h: 120, text: 'B' });
    const d = createNode('output', { x: 400, y: 220, w: 240, h: 120 });
    const e2 = addEdge(c.id, d.id); e2.command = '🖐️二'; layoutEdgeLabel(e2);
    window.__fetchDelay = 60;
    window.__fetchCalls = [];
    const seen = [];
    const signal = { aborted: false };
    const p = runAll({ signal, onProgress: (info) => seen.push({ ...info }) });
    await p;
    window.__fetchDelay = 0;
    return {
      seen,
      calls: window.__fetchCalls.length,
      first: seen[0], last: seen[seen.length - 1],
    };
  });
  check('有进度回调', progress.seen.length > 0, 'len=' + progress.seen.length);
  check('进度包含 total', typeof progress.first?.total === 'number',
        JSON.stringify(progress.first));
  check('进度递增到 total',
        progress.last?.done === progress.last?.total,
        JSON.stringify(progress.last));

  const cancel = await page.evaluate(async () => {
    clearCanvas();
    const mk = (y, i) => {
      const a = createNode('doc', { x: 40, y, w: 240, h: 100, text: 'X' + i });
      const b = createNode('output', { x: 400, y, w: 240, h: 100 });
      const e = addEdge(a.id, b.id); e.command = '🖐️' + i; layoutEdgeLabel(e);
      return e;
    };
    const es = [mk(40, 1), mk(180, 2), mk(320, 3), mk(460, 4)];
    window.__fetchDelay = 120;
    window.__fetchCalls = [];
    const signal = { aborted: false };
    setTimeout(() => { signal.aborted = true; }, 60);
    await runAll({ signal });
    window.__fetchDelay = 0;
    return { calls: window.__fetchCalls.length, edges: es.length };
  });
  check('取消后只执行了部分', cancel.calls < cancel.edges,
        `${cancel.calls} / ${cancel.edges}`);

  console.log('\n[10] 运行中节点有 .running 标记');
  const running = await page.evaluate(async () => {
    clearCanvas();
    const a = createNode('doc', { x: 40, y: 40, w: 240, h: 120, text: 'R' });
    const b = createNode('output', { x: 400, y: 40, w: 240, h: 120 });
    const e = addEdge(a.id, b.id); e.command = '🖐️跑'; layoutEdgeLabel(e);
    window.__fetchDelay = 300;
    const p = runEdge(e.id);
    await new Promise(r => setTimeout(r, 80));
    const during = {
      node: b.el.classList.contains('running'),
      edge: !!state.edges[e.id]?.running,
    };
    await p;
    window.__fetchDelay = 0;
    return {
      during,
      after: {
        node: b.el.classList.contains('running'),
        edge: !!state.edges[e.id]?.running,
      },
    };
  });
  check('运行中目标节点带 .running', running.during.node === true,
        JSON.stringify(running.during));
  check('运行中连线 running=true', running.during.edge === true,
        JSON.stringify(running.during));
  check('结束后节点移除 .running', running.after.node === false,
        JSON.stringify(running.after));

  console.log('\n[11] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
