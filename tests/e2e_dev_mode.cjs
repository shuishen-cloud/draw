// =========================================================================
// e2e_dev_mode.cjs —— 开发态（index.html + 原生 ES Module）冒烟测试
//
//   前置：node server.js   （默认 8090，可用 MC_BASE 覆盖）
//   运行：node tests/e2e_dev_mode.cjs
//
// 为什么需要它：build.js 把各模块拼进同一作用域，符号天然共享，
// 会**掩盖缺失的 ES import**。历史事故：nodes.js 只 import 了 runExecNode
// 却调用 runNodeById，所有跑 MutipleChat.html 的 e2e 全绿，只有开发态炸
// `ReferenceError: runNodeById is not defined`。
//
// 覆盖：页面零 pageerror / 执行节点 ▶ 可运行 / 结果在预览区可见。
// =========================================================================
const fs = require('fs');
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
const BASE = process.env.MC_BASE || 'http://localhost:8090';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✖', name, extra); }
}

// 模拟 LLM 流式响应。注意换行必须用 String.fromCharCode(10) 拼，
// 否则模板字符串会把 \n 编译成真实换行，SSE 帧结构被破坏（块数 = 0）。
const STUB_FETCH = `
  window.__calls = [];
  const NL = String.fromCharCode(10);
  window.fetch = async function(url) {
    if (!String(url).includes('deepseek')) return new Response('', { status: 200 });
    window.__calls.push(String(url));
    const enc = new TextEncoder();
    const frame = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '**DEV-RESULT**' } }] })
                + NL + NL + 'data: [DONE]' + NL + NL;
    return new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode(frame)); c.close(); }
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
`;

(async () => {
  // 开发态必须由 http 提供（file:// 下 ES Module 被 CORS 拦）
  let reachable = false;
  try {
    const res = await fetch(BASE + '/');
    reachable = res.ok;
  } catch (_) { reachable = false; }
  if (!reachable) {
    console.error(`无法访问 ${BASE}，请先运行 node server.js（或用 MC_BASE 指定地址）`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  const push = (s) => {
    // 浏览器自动请求 favicon.ico 的 404 与代码无关，忽略
    if (/favicon/.test(s) || /Failed to load resource/.test(s)) return;
    errs.push(s);
  };
  page.on('pageerror', e => push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') push('CONSOLE: ' + m.text()); });
  page.on('dialog', async d => { errs.push('ALERT: ' + d.message()); await d.dismiss(); });

  await page.addInitScript(() => localStorage.clear());
  await page.goto(BASE + '/');
  await page.waitForTimeout(800);
  await page.addScriptTag({ content: STUB_FETCH });

  console.log('\n[1] 开发态页面加载');
  check('ES Module 全部加载成功（无 pageerror）', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 执行节点 ▶ 按钮（历史 ReferenceError 触发点）');
  await page.fill('#apiKey', 'test-key');
  await page.click('#addExec');
  await page.click('#addDoc');
  await page.waitForTimeout(300);

  const exec = await page.$('.node[data-kind="exec"]');
  const doc = await page.$('.node[data-kind="doc"]');
  check('执行节点已创建', !!exec);
  check('文档节点已创建', !!doc);

  // 填提示词与输入内容（先切编辑态）
  await exec.$eval('.md-toggle', el => el.click());
  await exec.$eval('.exec-prompt', el => {
    el.value = '总结';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await doc.$eval('.md-toggle', el => el.click());
  await doc.$eval('textarea', el => {
    el.value = '素材内容';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);

  // 真实拖拽建线：从文档节点右边框外侧拖到执行节点
  const db = await doc.boundingBox();
  const eb = await exec.boundingBox();
  const sx = db.x + db.width + 6, sy = db.y + db.height / 2;
  const tx = eb.x + eb.width / 2, ty = eb.y + eb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(sx + (tx - sx) * i / 15, sy + (ty - sy) * i / 15);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const wires = await page.evaluate(() => document.querySelectorAll('#edges .wire').length);
  check('拖拽建立连线', wires >= 1, 'wires=' + wires);

  // 回到默认预览态（用户实际看到的状态）
  await exec.$eval('.md-toggle', el => el.click());
  await page.waitForTimeout(100);

  await exec.$eval('.run-node', el => el.click());
  await page.waitForTimeout(900);

  const r = await page.evaluate(() => {
    const n = document.querySelector('.node[data-kind="exec"]');
    const v = n.querySelector('.md-view');
    return {
      calls: window.__calls.length,
      mode: n.dataset.mode,
      preview: v.textContent.trim(),
      strong: v.innerHTML.includes('<strong>'),
      visible: !v.hidden,
    };
  });

  check('点 ▶ 未抛 ReferenceError', !errs.some(e => /ReferenceError/.test(e)), errs.join(' | '));
  check('请求已发出', r.calls >= 1, 'calls=' + r.calls);
  check('结果在预览区可见', r.preview.includes('DEV-RESULT'), JSON.stringify(r.preview));
  check('Markdown 渲染生效', r.strong === true, String(r.strong));
  check('未停留在「思考中…」', !r.preview.includes('思考中'), r.preview);

  console.log('\n[3] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
