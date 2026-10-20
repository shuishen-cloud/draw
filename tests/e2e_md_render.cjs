// =========================================================================
// e2e_md_render.cjs —— md-render 的端到端验证（手机视口）
//
//   先构建：node build.js
//   再运行：node tests/e2e_md_render.cjs
//
// 断言：预览切换、渲染结果正确、编辑态文本不被破坏、
//       预览态可滚动、无真实 <script> 注入、对话气泡渲染。
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

const MD = [
  '# 标题一',
  '',
  '一段 **粗体** 与 `行内码`。',
  '',
  '- 列表甲',
  '- 列表乙',
  '',
  '> 引用内容',
  '',
  '```js',
  'const a = 1;',
  '```',
].join('\n');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForTimeout(400);

  console.log('\n[1] 页面加载');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log('\n[2] 渲染器在浏览器环境正确 (renderMarkdown 可用)');
  const direct = await page.evaluate((src) => {
    const html = renderMarkdown(src);
    return {
      html,
      hasH1: /<h1>标题一<\/h1>/.test(html),
      hasStrong: /<strong>粗体<\/strong>/.test(html),
      hasCode: /<code>行内码<\/code>/.test(html),
      hasUl: /<ul>/.test(html),
      hasQuote: /<blockquote>/.test(html),
      hasPre: /<pre><code class="lang-js">/.test(html),
    };
  }, MD);
  check('标题', direct.hasH1, direct.html.slice(0, 120));
  check('粗体', direct.hasStrong);
  check('行内码', direct.hasCode);
  check('无序列表', direct.hasUl);
  check('引用', direct.hasQuote);
  check('代码块 + 语言', direct.hasPre);

  console.log('\n[3] 节点：编辑 / 预览切换');
  const setup = await page.evaluate((src) => {
    clearCanvas();
    const n = createNode('doc', { x: 30, y: 30, w: 320, h: 260 });
    n.textEl.value = src;
    n.text = src;
    view.scale = 1; view.x = 0; view.y = 0; applyView();
    return { id: n.id };
  }, MD);

  const beforeToggle = await page.evaluate((id) => {
    const el = state.nodes[id].el;
    return {
      mode: el.dataset.mode,
      bodyHidden: el.querySelector('.body').hidden,
      viewHidden: el.querySelector('.md-view').hidden,
      toggleText: el.querySelector('.md-toggle').textContent,
    };
  }, setup.id);
  check('初始为编辑模式', beforeToggle.mode === 'edit', beforeToggle.mode);
  check('初始 .md-view 隐藏', beforeToggle.viewHidden === true);
  check('按钮文案为「预览」', beforeToggle.toggleText === '预览', beforeToggle.toggleText);

  // 点击预览
  await page.locator('.node .md-toggle').first().click();
  await page.waitForTimeout(150);
  const afterToggle = await page.evaluate((id) => {
    const el = state.nodes[id].el;
    const v = el.querySelector('.md-view');
    return {
      mode: el.dataset.mode,
      bodyHidden: el.querySelector('.body').hidden,
      bodyDisplay: getComputedStyle(el.querySelector('.body')).display,
      viewHidden: v.hidden,
      toggleText: el.querySelector('.md-toggle').textContent,
      html: v.innerHTML,
      realScripts: v.querySelectorAll('script').length,
      h1Count: v.querySelectorAll('h1').length,
      ulCount: v.querySelectorAll('ul').length,
      preCount: v.querySelectorAll('pre').length,
      quoteCount: v.querySelectorAll('blockquote').length,
      textareaValue: el.querySelector('textarea').value,
    };
  }, setup.id);
  check('切到预览模式', afterToggle.mode === 'preview', afterToggle.mode);
  check('.body 被隐藏', afterToggle.bodyHidden === true);
  check('.body 真正不占布局空间（[hidden] 未被 display:flex 覆盖）',
        afterToggle.bodyDisplay === 'none', String(afterToggle.bodyDisplay));
  check('.md-view 显示', afterToggle.viewHidden === false);
  check('按钮文案变为「编辑」', afterToggle.toggleText === '编辑', afterToggle.toggleText);
  check('渲染出 h1', afterToggle.h1Count === 1, String(afterToggle.h1Count));
  check('渲染出 ul', afterToggle.ulCount === 1, String(afterToggle.ulCount));
  check('渲染出 pre', afterToggle.preCount === 1, String(afterToggle.preCount));
  check('渲染出 blockquote', afterToggle.quoteCount === 1, String(afterToggle.quoteCount));
  check('无真实 <script> 元素', afterToggle.realScripts === 0, String(afterToggle.realScripts));
  check('编辑态 textarea 值未被破坏', afterToggle.textareaValue === MD,
        JSON.stringify(afterToggle.textareaValue.slice(0, 40)));

  console.log('\n[4] 预览态：点击内容区切回编辑');
  await page.locator('.node .md-view').first().click();
  await page.waitForTimeout(120);
  const backToEdit = await page.evaluate((id) => {
    const el = state.nodes[id].el;
    return {
      mode: el.dataset.mode,
      bodyHidden: el.querySelector('.body').hidden,
      value: el.querySelector('textarea').value,
    };
  }, setup.id);
  check('点击后回到编辑模式', backToEdit.mode === 'edit', backToEdit.mode);
  check('编辑区重新显示', backToEdit.bodyHidden === false);
  check('文本内容完好', backToEdit.value === MD);

  console.log('\n[5] 预览态：内容可滚动（沿用滚动规范）');
  const scrollInfo = await page.evaluate((id) => {
    const n = state.nodes[id];
    n.textEl.value = '## 小标题\n\n正文行。\n\n'.repeat(60);
    n.text = n.textEl.value;
    setNodeMode(n, 'preview');
    const v = n.el.querySelector('.md-view');
    const cs = getComputedStyle(v);
    v.scrollTop = 100;
    return {
      scrollH: v.scrollHeight, clientH: v.clientHeight,
      overflowY: cs.overflowY, scrollTop: v.scrollTop,
      nodeH: n.el.getBoundingClientRect().height,
      configuredH: n.h,
    };
  }, setup.id);
  check('预览区有独立滚动', scrollInfo.scrollH > scrollInfo.clientH,
        `${scrollInfo.scrollH} > ${scrollInfo.clientH}`);
  check('预览区 overflow-y auto', scrollInfo.overflowY === 'auto', scrollInfo.overflowY);
  check('预览区可滚动', scrollInfo.scrollTop > 0, String(scrollInfo.scrollTop));
  check('节点高度未被预览内容撑大',
        Math.abs(scrollInfo.nodeH - scrollInfo.configuredH) <= 2,
        `${scrollInfo.nodeH} vs ${scrollInfo.configuredH}`);

  console.log('\n[6] XSS：预览渲染不产生可执行元素');
  const xss = await page.evaluate(() => {
    clearCanvas();
    const n = createNode('doc', { x: 30, y: 30, w: 320, h: 240 });
    n.text = '<script>window.__pwned=1</script>\n\n<img src=x onerror="window.__pwned=2">\n\n[点我](javascript:window.__pwned=3)';
    n.textEl.value = n.text;
    setNodeMode(n, 'preview');
    const v = n.el.querySelector('.md-view');
    return {
      scripts: v.querySelectorAll('script').length,
      imgs: v.querySelectorAll('img').length,
      anchors: v.querySelectorAll('a').length,
      pwned: window.__pwned ?? null,
      html: v.innerHTML,
    };
  });
  check('无 <script> 元素', xss.scripts === 0, String(xss.scripts));
  check('无 <img> 元素', xss.imgs === 0, String(xss.imgs));
  check('javascript: 链接未生成 <a>', xss.anchors === 0, String(xss.anchors));
  check('未执行任何注入脚本', xss.pwned === null, String(xss.pwned));

  console.log('\n[7] output / exec 节点也能预览');
  const kinds = await page.evaluate(() => {
    clearCanvas();
    const o = createNode('output', { x: 20, y: 20, w: 300, h: 200 });
    setOutput(o, '## 结果标题\n\n- 要点一\n- 要点二');
    setNodeMode(o, 'preview');
    const x = createNode('exec', { x: 20, y: 250, w: 320, h: 240 });
    x.prompt = '## 提示词标题';
    x.promptEl.value = x.prompt;
    setOutput(x, '执行结果 **加粗**');
    setNodeMode(x, 'preview');
    return {
      outputH2: o.el.querySelector('.md-view').querySelectorAll('h2').length,
      outputLi: o.el.querySelector('.md-view').querySelectorAll('li').length,
      execH2: x.el.querySelector('.md-view').querySelectorAll('h2').length,
      execStrong: x.el.querySelector('.md-view').querySelectorAll('strong').length,
    };
  });
  check('output 节点渲染 h2', kinds.outputH2 === 1, String(kinds.outputH2));
  check('output 节点渲染 li', kinds.outputLi === 2, String(kinds.outputLi));
  check('exec 节点渲染提示词 h2', kinds.execH2 === 1, String(kinds.execH2));
  check('exec 节点渲染结果 strong', kinds.execStrong === 1, String(kinds.execStrong));

  console.log('\n[8] 图片节点没有预览按钮');
  const imgKind = await page.evaluate(() => {
    const i = createNode('img', { x: 400, y: 20, w: 200, h: 160 });
    return { hasToggle: !!i.el.querySelector('.md-toggle') };
  });
  check('图片节点无预览按钮', imgKind.hasToggle === false);

  console.log('\n[9] 对话气泡渲染 Markdown');
  const bubble = await page.evaluate(() => {
    const el = addMsg('assistant', '## 回复标题\n\n- 要点', '助手');
    const el2 = addMsg('user', '**用户** 的内容', '我');
    return {
      asstH2: el.querySelectorAll('h2').length,
      asstLi: el.querySelectorAll('li').length,
      userStrong: el2.querySelectorAll('strong').length,
      userText: el2.textContent,
    };
  });
  check('助手气泡渲染 h2', bubble.asstH2 === 1, String(bubble.asstH2));
  check('助手气泡渲染 li', bubble.asstLi === 1, String(bubble.asstLi));
  check('用户气泡保持纯文本（不解析 Markdown）', bubble.userStrong === 0,
        'strong=' + bubble.userStrong);
  check('用户气泡原文可见', bubble.userText.includes('**用户**'), bubble.userText);

  console.log('\n[10] 预览态下流式写入会实时刷新');
  const live = await page.evaluate(() => {
    clearCanvas();
    const o = createNode('output', { x: 20, y: 20, w: 300, h: 200 });
    setNodeMode(o, 'preview');
    const before = o.el.querySelector('.md-view').innerHTML;
    setOutput(o, '## 流式标题\n\n第一块内容');
    const mid = o.el.querySelector('.md-view').innerHTML;
    setOutput(o, '## 流式标题\n\n第一块内容\n\n第二块 **加粗**');
    const after = o.el.querySelector('.md-view').innerHTML;
    return {
      before, mid, after,
      midH2: /<h2>流式标题<\/h2>/.test(mid),
      afterStrong: /<strong>加粗<\/strong>/.test(after),
    };
  });
  check('预览态初始为空占位', /md-empty/.test(live.before), live.before);
  check('流式第一块即渲染 h2', live.midH2, live.mid);
  check('流式后续块继续渲染', live.afterStrong, live.after);

  console.log('\n[11] 全程无异常');
  check('无 JS 异常', errs.length === 0, errs.join(' | '));

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
