// =========================================================================
// e2e_favorite_subgraph.cjs —— favorite-subgraph 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_favorite_subgraph.cjs
//
// 覆盖：闭包裁剪（跨框的边必须丢弃）、空选区、id 全部重分配、
//       导入后边正确重连、整体居中、图片 Blob 往返、无异常。
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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForTimeout(500);

  console.log('\n[1] 模块已接入');
  const mods = await page.evaluate(() => ({
    pick: typeof pickSubgraph === 'function',
    favSub: typeof favoriteSubgraph === 'function',
    restoreSub: typeof restoreSubgraph === 'function',
  }));
  check('pickSubgraph 存在', mods.pick);
  check('favoriteSubgraph 存在', mods.favSub);
  check('restoreSubgraph 存在', mods.restoreSub);

  console.log('\n[2] 闭包裁剪：跨框的边必须丢弃');
  const clip = await page.evaluate(() => {
    const nodes = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 200, y: 0, w: 100, h: 100 },
      { id: 'c', x: 800, y: 0, w: 100, h: 100 },   // 框外
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },       // 两端都在框内
      { id: 'e2', source: 'b', target: 'c' },       // c 在框外 → 丢弃
    ];
    const r = pickSubgraph({ x: -10, y: -10, w: 400, h: 200 }, nodes, edges);
    return {
      nodes: r.nodes.map(n => n.id).sort(),
      edges: r.edges.map(e => e.id),
      bounds: r.bounds,
    };
  });
  check('框内节点全收（a,b）', JSON.stringify(clip.nodes) === JSON.stringify(['a', 'b']),
        JSON.stringify(clip.nodes));
  check('框外节点被排除（无 c）', !clip.nodes.includes('c'));
  check('只保留两端都在框内的边（e1）',
        JSON.stringify(clip.edges) === JSON.stringify(['e1']), JSON.stringify(clip.edges));
  check('跨界边 e2 被裁剪', !clip.edges.includes('e2'));
  check('bounds 为内容包围盒',
        clip.bounds && clip.bounds.x === 0 && clip.bounds.w === 300,
        JSON.stringify(clip.bounds));

  console.log('\n[3] 空选区：不收藏');
  const empty = await page.evaluate(async () => {
    await clearCanvas();
    const before = (await listFavoriteNodes()).length;
    const r = await favoriteSubgraph({ x: 5000, y: 5000, w: 50, h: 50 });
    const after = (await listFavoriteNodes()).length;
    return { before, after, r, toast: document.getElementById('toast')?.textContent };
  });
  check('空选区返回 null', empty.r === null, String(empty.r));
  check('收藏数未变', empty.after === empty.before, `${empty.before} -> ${empty.after}`);
  check('有提示', /没有节点|空/.test(empty.toast || ''), String(empty.toast));

  console.log('\n[4] 框选收藏 → 落库');
  const saved = await page.evaluate(async (png) => {
    await clearCanvas();
    const a = createNode('doc', { x: 100, y: 100, w: 200, h: 150, title: 'A', text: 'A 的内容' });
    const b = createNode('output', { x: 400, y: 100, w: 200, h: 150, title: 'B' });
    const c = createNode('doc', { x: 1200, y: 100, w: 200, h: 150, title: 'C', text: '不该被收' });
    const e1 = addEdge(a.id, b.id); e1.command = '🖐️总结';
    const e2 = addEdge(b.id, c.id); e2.command = '不该被收';
    await new Promise(r => setTimeout(r, 50));

    const rect = { x: 50, y: 50, w: 600, h: 300 };
    const id = await favoriteSubgraph(rect, '框选A+B');
    const store = await openStore();
    const item = await store.get('items', id);
    const list = await listFavoriteNodes();
    return {
      id, kind: item?.kind, name: item?.name,
      nodeCount: item?.data?.nodes?.length,
      edgeCount: item?.data?.edges?.length,
      names: item?.data?.nodes?.map(n => n.title).sort(),
      cmd: item?.data?.edges?.[0]?.command,
      meta: item?.meta,
      listLen: list.length,
      ids: { a: a.id, b: b.id, c: c.id },
    };
  }, PNG);
  check('收藏项 kind 为 subgraph', saved.kind === 'subgraph', String(saved.kind));
  check('节点数 2（不含框外的 C）', saved.nodeCount === 2, String(saved.nodeCount));
  check('边数 1（跨界的被裁掉）', saved.edgeCount === 1, String(saved.edgeCount));
  check('节点标题正确', JSON.stringify(saved.names) === JSON.stringify(['A', 'B']),
        JSON.stringify(saved.names));
  check('边命令被保留', saved.cmd === '🖐️总结', String(saved.cmd));
  check('meta 计数正确',
        saved.meta?.nodeCount === 2 && saved.meta?.edgeCount === 1,
        JSON.stringify(saved.meta));

  console.log('\n[5] 导入：id 全部重新分配，边正确重连');
  const restored = await page.evaluate(async (savedId) => {
    const beforeNodes = Object.keys(state.nodes);
    const beforeEdges = Object.keys(state.edges);
    const res = await restoreSubgraph(savedId, { x: 0, y: 0 });
    const afterNodes = Object.keys(state.nodes);
    const added = afterNodes.filter(id => !beforeNodes.includes(id));
    const addedEdges = Object.keys(state.edges).filter(id => !beforeEdges.includes(id));
    const newNodes = added.map(id => state.nodes[id]);
    const suspicious = addedEdges.map(id => state.edges[id]).map(e => ({
      s: e.source, t: e.target,
      bothNew: added.includes(e.source) && added.includes(e.target),
    }));
    return {
      added, addedEdges,
      titles: newNodes.map(n => n.title).sort(),
      hasOldIds: added.some(id => Object.values({ a: 'x' }).includes(id)),
      allNewIds: added.every(id => !['n1', 'n2'].includes(id)),
      edgesOk: suspicious.every(x => x.bothNew),
      edgeCmd: suspicious.length ? state.edges[addedEdges[0]].command : null,
      ret: res,
    };
  }, saved.id);
  check('新增 2 个节点', restored.added.length === 2, String(restored.added.length));
  check('新增 1 条边', restored.addedEdges.length === 1, String(restored.addedEdges.length));
  check('导入节点标题正确', JSON.stringify(restored.titles) === JSON.stringify(['A', 'B']),
        JSON.stringify(restored.titles));
  check('新节点 id 全为新分配', restored.allNewIds === true, JSON.stringify(restored.added));
  check('边两端都指向新节点（无悬空）', restored.edgesOk === true);
  check('导入后命令仍保留', restored.edgeCmd === '🖐️总结', String(restored.edgeCmd));

  console.log('\n[6] 导入整体居中到指定坐标');
  const centered = await page.evaluate(async (savedId) => {
    await clearCanvas();
    await restoreSubgraph(savedId, { x: 1000, y: 1000 });
    const nodes = Object.values(state.nodes);
    const minX = Math.min(...nodes.map(n => n.x));
    const maxX = Math.max(...nodes.map(n => n.x + n.w));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxY = Math.max(...nodes.map(n => n.y + n.h));
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      n: nodes.length,
    };
  }, saved.id);
  check('子图中心 x 落在 1000', Math.abs(centered.cx - 1000) <= 1, String(centered.cx));
  check('子图中心 y 落在 1000', Math.abs(centered.cy - 1000) <= 1, String(centered.cy));
  check('节点数正确', centered.n === 2, String(centered.n));

  console.log('\n[7] 图片节点：Blob 分表往返');
  const imgCase = await page.evaluate(async (png) => {
    await clearCanvas();
    const a = createNode('doc', { x: 0, y: 0, w: 150, h: 120, title: '文字', text: 'x' });
    const im = createNode('img', { x: 200, y: 0, w: 150, h: 120, title: '图', src: png });
    const e = addEdge(a.id, im.id); e.command = '看图';
    const id = await favoriteSubgraph({ x: -20, y: -20, w: 500, h: 200 }, '带图');
    const store = await openStore();
    const item = await store.get('items', id);
    const imgEntry = item.data.nodes.find(n => n.kind === 'img');
    const blobRec = imgEntry?.srcKey ? await store.get('blobs', imgEntry.srcKey) : null;
    await clearCanvas();
    await restoreSubgraph(id, { x: 500, y: 500 });
    const newNode = Object.values(state.nodes).find(n => n.kind === 'img');
    return {
      hasSrcKey: !!imgEntry?.srcKey,
      inlined: !!imgEntry?.src,
      blobOk: blobRec?.blob instanceof Blob && blobRec.blob.size > 0,
      srcPrefix: (newNode?.src || '').slice(0, 5),
      newNodeCount: Object.keys(state.nodes).length,
      edgeCount: Object.keys(state.edges).length,
      hasImageMeta: item.meta.hasImage,
    };
  }, PNG);
  check('图片以 srcKey 存储（不内联）', imgCase.hasSrcKey === true && imgCase.inlined === false,
        JSON.stringify(imgCase));
  check('blobs 表有 Blob', imgCase.blobOk === true);
  check('meta.hasImage 为 true', imgCase.hasImageMeta === true);
  check('导入后图片 src 可用', /^(blob:|data:)/.test(imgCase.srcPrefix), imgCase.srcPrefix);
  check('导入后节点与边齐全',
        imgCase.newNodeCount === 2 && imgCase.edgeCount === 1,
        JSON.stringify(imgCase));

  console.log('\n[8] 面板预览：子图结构可读');
  const preview = await page.evaluate(async () => {
    await openFavoritesPanel();
    const row = [...document.querySelectorAll('#favList .fav-item')]
      .find(r => /框选A\+B|带图/.test(r.textContent));
    row?.click();
    await new Promise(r => setTimeout(r, 250));
    const box = document.getElementById('favPreview');
    return {
      subLabel: box.textContent.includes('节点'),
      edgeArrow: box.textContent.includes('→'),
      hasImport: !!box.querySelector('#favImport'),
      noInput: box.querySelectorAll('textarea,input').length,
    };
  });
  check('预览显示节点计数', preview.subLabel === true);
  check('预览显示边关系（→）', preview.edgeArrow === true);
  check('预览有导入按钮', preview.hasImport === true);
  check('预览是只读的', preview.noInput === 0, String(preview.noInput));

  console.log('\n[9] 框选模式：按钮可切换、Esc 退出');
  await page.click('#favSubgraph');
  const m1 = await page.evaluate(() => ({
    mode: document.getElementById('canvas')?.classList.contains('selecting'),
    hint: !document.getElementById('selectHint')?.hidden,
  }));
  await page.keyboard.press('Escape');
  const m2 = await page.evaluate(() => ({
    mode: document.getElementById('canvas')?.classList.contains('selecting'),
    hint: !document.getElementById('selectHint')?.hidden,
  }));
  check('点按钮进入框选模式', m1.mode === true, JSON.stringify(m1));
  check('框选模式有提示条', m1.hint === true);
  check('Esc 退出框选模式', m2.mode === false, JSON.stringify(m2));
  check('提示条一并隐藏', m2.hint === false);

  console.log('\n[10] 无异常');
  check('全程无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n合计 ${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
