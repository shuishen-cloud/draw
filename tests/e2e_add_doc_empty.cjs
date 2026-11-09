// =========================================================================
// e2e_add_doc_empty.cjs —— doc-node-empty-text 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_add_doc_empty.cjs
//
// 覆盖：新建文档节点内容为空 / placeholder 仍在 / 可正常输入 /
//       页面正文里不再出现默认提示语 / 无 JS 异常
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

const DEFAULT_TEXT = '在这里输入要处理的文档…';

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

  console.log('\n[1] 点「＋ 文档节点」新建的节点内容为空');
  const before = await page.evaluate(() => Object.keys(state.nodes).length);
  await page.click('#addDoc');
  await page.waitForTimeout(150);
  const created = await page.evaluate(() => {
    const ids = Object.keys(state.nodes);
    const id = ids[ids.length - 1];
    const n = state.nodes[id];
    const ta = n.el.querySelector('textarea');
    return {
      id, count: ids.length,
      text: n.text,
      hasTextarea: !!ta,
      value: ta ? ta.value : null,
      placeholder: ta ? ta.placeholder : null,
    };
  });

  check('确实新增了 1 个节点', created.count === before + 1, `${before} -> ${created.count}`);
  check('内部 state 的 text 为空串', created.text === '', JSON.stringify(created.text));
  check('textarea 的 value 为空', created.value === '', JSON.stringify(created.value));
  check('textarea 没有把提示语当内容',
        created.value !== DEFAULT_TEXT, JSON.stringify(created.value));
  check('textarea 仍有 placeholder（提示不丢）',
        !!created.placeholder && created.placeholder.length > 0,
        String(created.placeholder));

  console.log('\n[2] 新建后可直接输入（不是只读）');
  const typed = await page.evaluate((id) => {
    const n = state.nodes[id];
    const ta = n.el.querySelector('textarea');
    ta.value = '新写的正文';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { text: n.text, value: ta.value };
  }, created.id);
  check('输入后 state.text 同步', typed.text === '新写的正文', typed.text);
  check('输入后 textarea.value 正确', typed.value === '新写的正文', typed.value);

  console.log('\n[3] 页面上不再把提示语当作正文文本');
  const domHasDefault = await page.evaluate((t) => {
    const tas = [...document.querySelectorAll('.node textarea')];
    return {
      asValue: tas.filter(x => x.value === t).length,
      // 预览区（md-view）里也不该出现这句话
      asPreview: [...document.querySelectorAll('.node .md-view')]
        .filter(v => v.textContent.includes(t)).length,
    };
  }, DEFAULT_TEXT);
  check('没有 textarea 的 value 等于提示语', domHasDefault.asValue === 0,
        'count=' + domHasDefault.asValue);
  check('没有预览区把提示语渲染成正文', domHasDefault.asPreview === 0,
        'count=' + domHasDefault.asPreview);

  console.log('\n[4] 连续新建多个都是空的');
  await page.click('#addDoc');
  await page.click('#addDoc');
  await page.waitForTimeout(150);
  const multi = await page.evaluate(() => {
    const ids = Object.keys(state.nodes);
    const lastTwo = ids.slice(-2).map(id => {
      const ta = state.nodes[id].el.querySelector('textarea');
      return { text: state.nodes[id].text, value: ta?.value };
    });
    return lastTwo;
  });
  check('连续新建的节点内容都为空',
        multi.every(m => m.text === '' && m.value === ''),
        JSON.stringify(multi));

  console.log('\n[5] 显式传入 text 的场景不受影响（导入/示例）');
  const explicit = await page.evaluate(() => {
    const n = createNode('doc', { x: 10, y: 10, text: '导入来的内容' });
    return { text: n.text, value: n.el.querySelector('textarea').value };
  });
  check('显式传 text 仍生效', explicit.text === '导入来的内容', JSON.stringify(explicit));
  check('显式传 text 时 textarea 同步', explicit.value === '导入来的内容', explicit.value);

  console.log('\n[6] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n合计 ${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
