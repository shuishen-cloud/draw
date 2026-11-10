// =========================================================================
// e2e_chattool_append.cjs —— ChatTool 卡片「追加导入」的真实页面验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_chattool_append.cjs
//
// 为什么不用 node --test：appendCanvasData 走 createNode → renderNode →
// layoutNode → redrawEdges，全程真实操作 DOM 与 SVG。纯函数部分已在
// tests/test_chattool.mjs 覆盖，这里只验证「不清空」这个核心行为以及
// 端到端的 origin 落库。
//
// 覆盖：
//   [1] 已有 1 个节点 → 追加 2 张卡片，节点总数变 3（未被清空）
//   [2] 卡片带 origin.messageId，且可在 exportCanvasData 里往返
//   [3] 重复追加同一份 → 全部跳过，节点数不变（幂等）
//   [4] 追加不动视口
//   [5] 非法 payload → 明确报错，且画布保持原样
//   [6] 孤立边（端点不存在）被跳过，不产生脏边
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

// 页面内构造 ChatTool 真实形状的 payload
const PAYLOAD_SRC = `
  window.__ctPayload = () => ({
    format: 'mutiplechat-canvas', version: 1, generator: 'ChatTool',
    view: { x: 0, y: 0, scale: 1 },
    nodes: [
      { id: 'n1', kind: 'doc', title: '会话A · 片段一', x: 160, y: 160, w: 300, h: 160,
        text: '> 角色：user\\n> 来源：《会话A》\\n\\n正文一', src: '', prompt: '',
        zoneId: null, level: 1 },
      { id: 'n2', kind: 'doc', title: '会话B · 片段二', x: 520, y: 160, w: 300, h: 160,
        text: '正文二', src: '', prompt: '', zoneId: null, level: 1 },
    ],
    edges: [], zones: [], tasks: [],
    draw_cards: [
      { nodeId: 'n1', messageId: 'm_1', convId: 'c_1', convTitle: '会话A',
        role: 'user', tags: ['论文'], favoriteAt: '2025-11-01T10:00:00', source: 'chattool' },
      { nodeId: 'n2', messageId: 'm_2', convId: 'c_2', convTitle: '会话B',
        role: 'assistant', tags: [], favoriteAt: '2025-11-02T09:30:00', source: 'chattool' },
    ],
  });
`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.addScriptTag({ content: PAYLOAD_SRC });
  await page.waitForTimeout(300);
  const run = (fn, arg) => page.evaluate(fn, arg);

  // ---- [1] 追加不清空 ----
  console.log('\n[1] 已有 1 个节点 → 追加 2 张卡片，总数应为 3');
  const r1 = await run(() => {
    clearCanvas();
    createNode('doc', { x: 60, y: 60, title: '我原来的卡片', text: '别删我' });
    const before = Object.keys(state.nodes).length;
    const res = appendChatToolData(__ctPayload());
    const nodes = Object.values(state.nodes);
    return {
      before, after: nodes.length, res,
      keptOriginal: nodes.some(n => n.title === '我原来的卡片' && n.text === '别删我'),
      titles: nodes.map(n => n.title),
    };
  });
  check('追加前 1 个节点', r1.before === 1, String(r1.before));
  check('追加后 3 个节点（未被清空）', r1.after === 3, JSON.stringify(r1.titles));
  check('原卡片内容完好', r1.keptOriginal === true);
  check('新增 2 张，跳过 0', r1.res.added === 2 && r1.res.skipped === 0, JSON.stringify(r1.res));

  // ---- [2] origin 落库 + 导出往返 ----
  console.log('\n[2] 卡片 origin.messageId 写入，且导出后仍在');
  const r2 = await run(() => {
    const nodes = Object.values(state.nodes).filter(n => n.origin);
    const exported = exportCanvasData().nodes.filter(n => n.origin);
    return {
      count: nodes.length,
      ids: nodes.map(n => n.origin.messageId).sort(),
      expIds: exported.map(n => n.origin.messageId).sort(),
      conv: nodes.find(n => n.origin.messageId === 'm_1')?.origin.convTitle,
      tags: nodes.find(n => n.origin.messageId === 'm_1')?.origin.tags,
      source: nodes[0]?.origin.source,
    };
  });
  check('2 张卡片都带 origin', r2.count === 2, String(r2.count));
  check('messageId 正确', JSON.stringify(r2.ids) === '["m_1","m_2"]', JSON.stringify(r2.ids));
  check('convTitle 保留', r2.conv === '会话A', String(r2.conv));
  check('tags 保留', JSON.stringify(r2.tags) === '["论文"]', JSON.stringify(r2.tags));
  check('source 标记为 chattool', r2.source === 'chattool', String(r2.source));
  check('exportCanvasData 仍带 origin', JSON.stringify(r2.expIds) === '["m_1","m_2"]',
    JSON.stringify(r2.expIds));

  // ---- [3] 幂等 ----
  console.log('\n[3] 再次追加同一份 → 全部跳过，节点数不变');
  const r3 = await run(() => {
    const before = Object.keys(state.nodes).length;
    const res = appendChatToolData(__ctPayload());
    return { before, after: Object.keys(state.nodes).length, res };
  });
  check('节点数不变', r3.after === r3.before, `${r3.before} -> ${r3.after}`);
  check('新增 0，跳过 2', r3.res.added === 0 && r3.res.skipped === 2, JSON.stringify(r3.res));

  // ---- [4] 不动视口 ----
  console.log('\n[4] 追加不改动当前视口');
  const r4 = await run(() => {
    clearCanvas();
    view.x = -123; view.y = 45; view.scale = 1.5;
    appendChatToolData(__ctPayload());
    return { x: view.x, y: view.y, scale: view.scale };
  });
  check('view.x 未变', r4.x === -123, String(r4.x));
  check('view.y 未变', r4.y === 45, String(r4.y));
  check('view.scale 未变', r4.scale === 1.5, String(r4.scale));

  // ---- [5] 非法 payload ----
  console.log('\n[5] 非法 payload：抛错且画布原样');
  const r5 = await run(() => {
    clearCanvas();
    createNode('doc', { x: 0, y: 0, title: '保留我' });
    let msg = '';
    try { appendChatToolData({ nodes: [] }); } catch (e) { msg = e.message; }
    return { msg, count: Object.keys(state.nodes).length };
  });
  check('抛出明确错误', /不是有效的画布数据/.test(r5.msg), r5.msg);
  check('画布未被破坏', r5.count === 1, String(r5.count));

  // ---- [6] 孤立边被跳过 ----
  console.log('\n[6] 端点不存在的边被跳过');
  const r6 = await run(() => {
    clearCanvas();
    const p = __ctPayload();
    p.edges = [{ id: 'e1', source: 'n1', target: 'ghost', command: '' }];
    const res = appendChatToolData(p);
    return { res, edges: Object.keys(state.edges).length, nodes: Object.keys(state.nodes).length };
  });
  check('节点仍追加成功', r6.nodes === 2 && r6.res.added === 2, JSON.stringify(r6.res));
  check('无脏边残留', r6.edges === 0, String(r6.edges));

  // ---- [7] 网络失败提示（不真有服务，靠 Promise 拒绝分支）----
  console.log('\n[7] ChatTool 未启动时给出可操作提示');
  const r7 = await run(async () => {
    try {
      await importFromChatTool('http://127.0.0.1:1/api/favorites/draw');
      return { ok: true, msg: '' };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
  check('拉取失败并抛出提示', r7.ok === false && /ChatTool/.test(r7.msg), r7.msg);

  // ---- 页面无报错（第 7 项会主动产生一次网络错误，忽略）----
  const realErrs = errs.filter(e => !/Failed to fetch|ERR_CONNECTION_REFUSED|net::/i.test(e));
  check('页面无意外报错', realErrs.length === 0, realErrs.join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
