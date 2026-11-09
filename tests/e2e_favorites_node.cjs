// =========================================================================
// e2e_favorites_node.cjs —— favorites-node 的端到端验证
//
//   先构建：node build.js
//   再运行：node tests/e2e_favorites_node.cjs
//
// 覆盖：IndexedDB 写入/读取/删除、查阅预览、导入落点、图片 Blob 往返、
//       降级到 localStorage、无 JS 异常。
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

const MD_TEXT = '# 收藏测试\n\n- 条目一\n- 条目二\n\n> 引用';

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
    store: typeof openStore === 'function',
    fav: typeof favoriteNode === 'function',
    restore: typeof restoreNode === 'function',
    selectedNodeId: 'selectedNodeId' in state,
  }));
  check('openStore 存在', mods.store);
  check('favoriteNode 存在', mods.fav);
  check('restoreNode 存在', mods.restore);
  check('state.selectedNodeId 已加入', mods.selectedNodeId);

  console.log('\n[2] 收藏文档节点 → IndexedDB 落库');
  const fav = await page.evaluate(async (mdText) => {
    await clearCanvas();
    const n = createNode('doc', { x: 100, y: 100, title: '待收藏', text: mdText });
    selectNode(n.id);
    const before = await listFavoriteNodes();
    const id = await favoriteNode(n.id, '我的收藏');
    const store = await openStore();
    const raw = await store.get('items', id);
    const after = await listFavoriteNodes();
    return {
      before: before.length, after: after.length,
      id, backend: store.backend,
      kind: raw?.kind, name: raw?.name,
      meta: raw?.meta,
      text: raw?.data?.text,
      nodeId: n.id,
    };
  }, MD_TEXT);
  check('收藏前列表为空', fav.before === 0, String(fav.before));
  check('收藏后列表 +1', fav.after === 1, String(fav.after));
  check('kind 为 node', fav.kind === 'node', String(fav.kind));
  check('名称已记录', fav.name === '我的收藏', String(fav.name));
  check('meta.nodeKind 为 doc', fav.meta?.nodeKind === 'doc', JSON.stringify(fav.meta));
  check('正文完整保存', fav.text === MD_TEXT, JSON.stringify(fav.text));
  check('后端为 idb', fav.backend === 'idb', String(fav.backend));

  console.log('\n[3] 查阅面板：只读预览');
  await page.evaluate(() => openFavoritesPanel());
  await page.waitForTimeout(200);
  const panel = await page.evaluate(() => ({
    visible: !document.getElementById('favPanel')?.hidden,
    rows: document.querySelectorAll('#favList .fav-item').length,
  }));
  check('面板可见', panel.visible === true);
  check('列表有 1 条', panel.rows === 1, String(panel.rows));

  await page.evaluate(() => document.querySelector('#favList .fav-item').click());
  await page.waitForTimeout(200);
  const preview = await page.evaluate(() => {
    const box = document.getElementById('favPreview');
    return {
      h1: box.querySelectorAll('h1').length,
      li: box.querySelectorAll('li').length,
      hasInput: box.querySelectorAll('textarea,input,[contenteditable="true"]').length,
    };
  });
  check('预览渲染出标题', preview.h1 >= 1, String(preview.h1));
  check('预览渲染出列表', preview.li >= 2, String(preview.li));
  check('预览是只读的（无输入控件）', preview.hasInput === 0, String(preview.hasInput));

  console.log('\n[4] 导入到画布：落点在视口中心附近');
  const imported = await page.evaluate(async () => {
    const before = Object.keys(state.nodes).length;
    const center = viewportCenterWorld();
    const newId = await restoreNode(
      (await listFavoriteNodes())[0].id, center);
    const n = state.nodes[newId];
    return {
      before, after: Object.keys(state.nodes).length,
      text: n?.text, title: n?.title,
      dx: n ? Math.abs(n.x - (center.x - n.w / 2)) : 9999,
      dy: n ? Math.abs(n.y - (center.y - n.h / 2)) : 9999,
      selected: state.selectedNodeId === newId,
    };
  });
  check('节点数 +1', imported.after === imported.before + 1,
        `${imported.before} -> ${imported.after}`);
  check('导入内容一致', imported.text === MD_TEXT, JSON.stringify(imported.text));
  check('落点 x 居中（误差 < 2px）', imported.dx < 2, String(imported.dx));
  check('落点 y 居中（误差 < 2px）', imported.dy < 2, String(imported.dy));
  check('导入后自动选中', imported.selected === true);

  console.log('\n[5] 图片节点：Blob 分表往返');
  const img = await page.evaluate(async () => {
    await clearCanvas();
    // 1x1 红色 PNG
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const n = createNode('img', { x: 10, y: 10, title: '图', src: dataUrl });
    const fid = await favoriteNode(n.id, '图片收藏');
    const store = await openStore();
    const item = await store.get('items', fid);
    const blobRec = item?.data?.srcKey ? await store.get('blobs', item.data.srcKey) : null;
    const newId = await restoreNode(fid, { x: 200, y: 200 });
    const nn = state.nodes[newId];
    return {
      hasSrcKey: !!item?.data?.srcKey,
      blobIsBlob: blobRec?.blob instanceof Blob,
      blobSize: blobRec?.blob?.size ?? 0,
      inlinedInItem: !!item?.data?.src,
      newSrcPrefix: (nn?.src || '').slice(0, 5),
      newSrcLen: (nn?.src || '').length,
    };
  });
  check('元数据里只有 srcKey（不内联 base64）', img.hasSrcKey === true && img.inlinedInItem === false,
        JSON.stringify(img));
  check('图片以 Blob 存于 blobs 表', img.blobIsBlob === true);
  check('Blob 有内容', img.blobSize > 0, String(img.blobSize));
  check('导入后 src 为可用 URL', /^(blob:|data:)/.test(img.newSrcPrefix), img.newSrcPrefix);
  check('导入后 src 有长度', img.newSrcLen > 20, String(img.newSrcLen));

  console.log('\n[6] 删除收藏：items 与 blobs 一并清除');
  const del = await page.evaluate(async () => {
    const list = await listFavoriteNodes();
    const id = list[0].id;
    const store = await openStore();
    const item = await store.get('items', id);
    const key = item?.data?.srcKey;
    const before = (await listFavoriteNodes()).length;
    const ok = await removeFavorite(id);
    const rest = await listFavoriteNodes();
    return {
      ok, before,
      items: rest.length,
      stillThere: rest.some(x => x.id === id),
      itemGone: (await store.get('items', id)) === undefined,
      blobGone: key ? (await store.get('blobs', key)) === undefined : true,
    };
  });
  check('removeFavorite 返回 true', del.ok === true);
  check('列表少了一条', del.items === del.before - 1, `${del.before} -> ${del.items}`);
  check('被删的那条已不在列表', del.stillThere === false);
  check('items 记录已删', del.itemGone === true);
  check('blobs 记录已删', del.blobGone === true);

  console.log('\n[7] 降级：IndexedDB 不可用时回落 localStorage');
  const fallbackPage = await ctx.newPage();
  const ferrs = [];
  fallbackPage.on('pageerror', e => ferrs.push(e.message));
  // 在页面脚本执行前把 indexedDB.open 换成必定失败
  await fallbackPage.addInitScript(() => {
    const orig = indexedDB.open.bind(indexedDB);
    let calls = 0;
    indexedDB.open = function (...args) {
      calls++;
      const req = {};
      setTimeout(() => {
        req.error = new Error('blocked');
        req.onerror && req.onerror({ target: req });
      }, 0);
      return req;
    };
    window.__idbCalls = () => calls;
    void orig;
  });
  await fallbackPage.goto('file://' + HTML);
  await fallbackPage.waitForTimeout(600);
  const fb = await fallbackPage.evaluate(async () => {
    const store = await openStore();
    const n = createNode('doc', { x: 0, y: 0, title: '降级', text: 'fallback' });
    const id = await favoriteNode(n.id, '降级收藏');
    const list = await listFavoriteNodes();
    return {
      backend: store.backend,
      id, n: list.length,
      text: list[0]?.data?.text,
      lsKeys: Object.keys(localStorage).filter(k => k.startsWith('mc_fav')),
    };
  });
  check('降级后端为 local', fb.backend === 'local', String(fb.backend));
  check('降级后仍能收藏', fb.n === 1, String(fb.n));
  check('降级后内容正确', fb.text === 'fallback', String(fb.text));
  check('降级数据写进 localStorage', fb.lsKeys.length > 0, JSON.stringify(fb.lsKeys));
  check('降级页面无异常', ferrs.length === 0, ferrs.join(' | '));
  await fallbackPage.close();

  console.log('\n[8] 多标签页并发收藏：id 必须唯一，不能互相覆盖');
  const pA = await ctx.newPage();
  const pB = await ctx.newPage();
  const ccErrs = [];
  for (const pg of [pA, pB]) {
    pg.on('pageerror', e => ccErrs.push(e.message));
    await pg.goto('file://' + HTML);
    await pg.waitForTimeout(400);
  }
  const [idA, idB] = await Promise.all([
    pA.evaluate(async () => {
      await clearCanvas();
      const n = createNode('doc', { x: 0, y: 0, text: 'A' });
      return favoriteNode(n.id, '并发A');
    }),
    pB.evaluate(async () => {
      await clearCanvas();
      const n = createNode('doc', { x: 0, y: 0, text: 'B' });
      return favoriteNode(n.id, '并发B');
    }),
  ]);
  check('两个标签页生成的收藏 id 不同', idA !== idB, `${idA} vs ${idB}`);
  const both = await pA.evaluate(async () => {
    await __resetStore();                 // 重新探测，读取最新库
    const l = await listFavoriteNodes();
    return { n: l.length, names: l.map(x => x.name).sort() };
  });
  check('两条并发收藏都保留', both.names.includes('并发A') && both.names.includes('并发B'),
        JSON.stringify(both));
  check('两个名字都在', both.names.includes('并发A') && both.names.includes('并发B'),
        JSON.stringify(both.names));
  check('并发页面无异常', ccErrs.length === 0, ccErrs.join(' | '));
  await pA.close();
  await pB.close();

  console.log('\n[9] 无异常');
  check('主页面无 JS 异常', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log(`\n合计 ${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
