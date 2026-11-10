// =========================================================================
// test_chattool.mjs —— chattool-cards 阶段的纯函数测试（node --test）
//
//   运行：node --test tests/test_chattool.mjs
//   覆盖：normalizeChatToolPayload / mapCardsToNodes /
//         dedupeByMessageId / planLayout / CHATTOOL_DRAW_URL
//
// 全部是不碰 DOM 的纯逻辑，故用 node --test 而非 Playwright。
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATTOOL_DRAW_URL, CHATTOOL_PREFIX, resolveChatToolUrl, LOCAL_CHATTOOL_DRAW_URL,
  KINDS, ORIGIN_SOURCE,
  normalizeChatToolPayload, mapCardsToNodes, dedupeByMessageId, planLayout,
  toFavoriteItems,
} from '../js/chattool.js';

// ---- 构造一份 ChatTool 真实返回（GET /api/favorites/draw 实测形状）----
function cardPayload() {
  return {
    format: 'mutiplechat-canvas',
    version: 1,
    generator: 'ChatTool',
    view: { x: 0, y: 0, scale: 1 },
    nodes: [
      {
        id: 'n1', kind: 'doc', title: '会话A · 片段一',
        x: 160, y: 160, w: 300, h: 160,
        text: '> 角色：user\n> 来源：《会话A》\n\n正文一',
        src: '', prompt: '', zoneId: null, level: 1,
      },
      {
        id: 'n2', kind: 'doc', title: '会话B · 片段二',
        x: 520, y: 160, w: 300, h: 160,
        text: '正文二', src: '', prompt: '', zoneId: null, level: 1,
      },
    ],
    edges: [],
    zones: [],
    tasks: [],
    draw_cards: [
      {
        nodeId: 'n1', messageId: 'm_1', convId: 'c_1', convTitle: '会话A',
        role: 'user', tags: ['论文', '本周复盘'],
        favoriteAt: '2025-11-01T10:00:00', source: 'chattool',
      },
      {
        nodeId: 'n2', messageId: 'm_2', convId: 'c_2', convTitle: '会话B',
        role: 'assistant', tags: [], favoriteAt: '2025-11-02T09:30:00',
        source: 'chattool',
      },
    ],
  };
}

// ---------------------------------------------------------------- 常量
test('CHATTOOL_DRAW_URL 在 node（无 location）下回退到本机 8765', () => {
  // node --test 里没有 location，等价于 file:// 离线形态
  assert.equal(CHATTOOL_DRAW_URL, 'http://127.0.0.1:8765/api/favorites/draw');
  assert.equal(LOCAL_CHATTOOL_DRAW_URL, 'http://127.0.0.1:8765/api/favorites/draw');
});

// ---------------------------------------------------------------- 地址推导
// 锁定 doc/feat/chattool-url-origin.md §2.4 的判定矩阵。
// 127.0.0.1 的语义是「打开页面的这台设备自己」，不是「ChatTool 所在机器」。
// 服务器部署后若还连 127.0.0.1，电脑连自己、手机连手机，请求根本到不了服务器。
test('resolveChatToolUrl：服务器域名 → 同源 /chat 路径', () => {
  assert.equal(
    resolveChatToolUrl({ protocol: 'https:', origin: 'https://ex.com', hostname: 'ex.com' }),
    'https://ex.com/chat/api/favorites/draw');
  // 带端口的外网地址也应按 origin 走
  assert.equal(
    resolveChatToolUrl({ protocol: 'http:', origin: 'http://1.2.3.4:8080', hostname: '1.2.3.4' }),
    'http://1.2.3.4:8080/chat/api/favorites/draw');
});

test('resolveChatToolUrl：localhost / 127.0.0.1 / ::1 → 回退本机 8765', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1']) {
    assert.equal(
      resolveChatToolUrl({ protocol: 'http:', origin: 'http://' + hostname + ':8090', hostname }),
      'http://127.0.0.1:8765/api/favorites/draw',
      '本机开发不应去连 :8090/chat（server.js 没这条路由）');
  }
});

test('resolveChatToolUrl：file:// 与缺失 location → 回退本机 8765', () => {
  assert.equal(resolveChatToolUrl({ protocol: 'file:', origin: 'null', hostname: '' }),
               'http://127.0.0.1:8765/api/favorites/draw');
  assert.equal(resolveChatToolUrl(null), 'http://127.0.0.1:8765/api/favorites/draw');
  assert.equal(resolveChatToolUrl(undefined), 'http://127.0.0.1:8765/api/favorites/draw');
});

test('resolveChatToolUrl：origin 缺失时不死循环地拼出 undefined', () => {
  // 防御：protocol 是 http: 但 origin 为空（部分奇葩环境）→ 应回退本机而不是拼 "undefined/chat"
  assert.equal(resolveChatToolUrl({ protocol: 'http:', origin: '', hostname: 'ex.com' }),
               'http://127.0.0.1:8765/api/favorites/draw');
});

test('CHATTOOL_PREFIX 与 ChatTool 部署前缀一致', () => {
  // 跨仓库约定：ChatTools 侧 CHATTOOL_PREFIX=/chat
  assert.equal(CHATTOOL_PREFIX, '/chat');
});

test('KINDS 是画布支持的节点类型白名单', () => {
  assert.deepEqual([...KINDS].sort(), ['doc', 'exec', 'img', 'output']);
});

// ---------------------------------------------------------------- 解包
test('normalizeChatToolPayload：解 {ok:true,data:...} 包裹', () => {
  const p = normalizeChatToolPayload({ ok: true, data: cardPayload() });
  assert.equal(p.nodes.length, 2);
  assert.equal(p.nodes[0].id, 'n1');
  assert.equal(p.cards.get('n1').messageId, 'm_1');
});

test('normalizeChatToolPayload：裸数据（.json 下载版）也接受', () => {
  const p = normalizeChatToolPayload(cardPayload());
  assert.equal(p.nodes.length, 2);
});

test('normalizeChatToolPayload：ok:false 时抛后端 error 文案', () => {
  assert.throws(
    () => normalizeChatToolPayload({ ok: false, error: '没有可分享的收藏' }),
    /没有可分享的收藏/,
  );
});

test('normalizeChatToolPayload：缺 format 视为非法画布数据', () => {
  assert.throws(() => normalizeChatToolPayload({ nodes: [] }), /不是有效的画布数据/);
  assert.throws(() => normalizeChatToolPayload(null), /不是有效的画布数据/);
});

test('normalizeChatToolPayload：缺 nodes / draw_cards 时按空数组兜底', () => {
  const p = normalizeChatToolPayload({ format: 'mutiplechat-canvas' });
  assert.deepEqual(p.nodes, []);
  assert.equal(p.cards.size, 0);
});

// ---------------------------------------------------------------- 映射
test('mapCardsToNodes：origin 元信息完整写入', () => {
  const descs = mapCardsToNodes(normalizeChatToolPayload(cardPayload()));
  const d = descs.find(x => x.title.includes('片段一'));
  assert.deepEqual(d.origin, {
    source: ORIGIN_SOURCE,
    messageId: 'm_1',
    convId: 'c_1',
    convTitle: '会话A',
    role: 'user',
    tags: ['论文', '本周复盘'],
    favoriteAt: '2025-11-01T10:00:00',
  });
});

test('mapCardsToNodes：没有对应 draw_card 的节点 origin 为 null', () => {
  const raw = cardPayload();
  raw.draw_cards = [raw.draw_cards[0]];      // 去掉 n2 的元信息
  const descs = mapCardsToNodes(normalizeChatToolPayload(raw));
  assert.equal(descs.length, 2);
  assert.equal(descs[1].origin, null);
});

test('mapCardsToNodes：未知 kind 回落到 doc（白名单）', () => {
  const raw = cardPayload();
  raw.nodes[0].kind = 'weird-kind';
  const descs = mapCardsToNodes(normalizeChatToolPayload(raw));
  assert.equal(descs[0].kind, 'doc');
});

test('mapCardsToNodes：title 缺失时回落到会话标题，再回落「收藏」', () => {
  const raw = cardPayload();
  raw.nodes[0].title = '';
  raw.nodes[1].title = '';
  raw.draw_cards[1].convTitle = '';
  const descs = mapCardsToNodes(normalizeChatToolPayload(raw));
  assert.equal(descs[0].title, '会话A');
  assert.equal(descs[1].title, '收藏');
});

test('mapCardsToNodes：保留正文与尺寸，非法尺寸回落默认', () => {
  const raw = cardPayload();
  raw.nodes[0].w = 'abc';
  raw.nodes[0].h = 0;
  const descs = mapCardsToNodes(normalizeChatToolPayload(raw));
  assert.equal(descs[0].text, raw.nodes[0].text);
  assert.equal(descs[0].w, 300);
  assert.equal(descs[0].h, 160);
});

// ---------------------------------------------------------------- 去重
test('dedupeByMessageId：已有画布上的同一 messageId 被视为重复', () => {
  const descs = mapCardsToNodes(normalizeChatToolPayload(cardPayload()));
  const existing = [{ id: 'n1', origin: { source: ORIGIN_SOURCE, messageId: 'm_1' } }];
  const { kept, skipped } = dedupeByMessageId(descs, existing);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(kept[0].origin.messageId, 'm_2');
  assert.equal(skipped[0].origin.messageId, 'm_1');
});

test('dedupeByMessageId：同一批内部重复也只保留第一张', () => {
  const descs = mapCardsToNodes(normalizeChatToolPayload(cardPayload()));
  descs[1].origin.messageId = 'm_1';          // 人为让两条同 messageId
  const { kept, skipped } = dedupeByMessageId(descs, []);
  assert.equal(kept.length, 1);
  assert.equal(skipped.length, 1);
});

test('dedupeByMessageId：没有 messageId 的卡片全保留（自由笔记不该被吞）', () => {
  const raw = cardPayload();
  raw.draw_cards = [];
  const descs = mapCardsToNodes(normalizeChatToolPayload(raw));
  const { kept, skipped } = dedupeByMessageId(descs, []);
  assert.equal(kept.length, 2);
  assert.equal(skipped.length, 0);
});

// ---------------------------------------------------------------- 排布
test('planLayout：空画布 → 3 列网格，从左到右再换行', () => {
  const descs = Array.from({ length: 4 }, (_, i) => ({ w: 300, h: 160, title: 't' + i }));
  const out = planLayout(descs, []);
  assert.equal(out.length, 4);
  // 前三张同一行（y 相同），x 递增
  assert.equal(out[0].y, out[1].y);
  assert.equal(out[1].y, out[2].y);
  assert.ok(out[0].x < out[1].x && out[1].x < out[2].x);
  // 第四张换行
  assert.ok(out[3].y > out[0].y);
  assert.equal(out[3].x, out[0].x);
});

test('planLayout：起点避开已有节点的包围盒（不压在旧卡片上）', () => {
  const existing = [{ x: 100, y: 100, w: 300, h: 160 }];
  const out = planLayout([{ w: 300, h: 160, title: 'new' }], existing);
  const n = out[0];
  const overlap = !(n.x + n.w <= 100 || n.x >= 400 || n.y + n.h <= 100 || n.y >= 260);
  assert.equal(overlap, false, `新卡片 ${JSON.stringify(n)} 与已有节点重叠`);
});

test('planLayout：多张新卡片之间互不重叠', () => {
  const descs = Array.from({ length: 7 }, (_, i) => ({ w: 300, h: 160, title: 't' + i }));
  const out = planLayout(descs, [{ x: 160, y: 160, w: 300, h: 160 }]);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const overlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
      assert.equal(overlap, false, `第 ${i} 与第 ${j} 张重叠`);
    }
  }
});

test('planLayout：空输入返回空数组', () => {
  assert.deepEqual(planLayout([], []), []);
});

// ---------------------------------------------------------------- 收藏条目
// chattool-inbox：拉取不再直落画布，而是先入收藏库。
// toFavoriteItems 负责把「待建节点描述」转成 FavoriteItem（kind='chattool'）。
test('toFavoriteItems：kind 固定为 chattool，id 唯一且可重现', () => {
  const descs = mapCardsToNodes(normalizeChatToolPayload(cardPayload()));
  const items = toFavoriteItems(descs);
  assert.equal(items.length, 2);
  for (const it of items) {
    assert.equal(it.kind, 'chattool');
    assert.ok(it.id, 'id 不能为空');
    assert.ok(it.createdAt, 'createdAt 不能为空');
  }
  assert.notEqual(items[0].id, items[1].id, '两条收藏 id 不能相同');
});

test('toFavoriteItems：id 由 messageId 派生，同一 messageId 恒得同一 id', () => {
  const mk = () => toFavoriteItems(mapCardsToNodes(normalizeChatToolPayload(cardPayload())));
  const a = mk(), b = mk();
  assert.deepEqual(a.map(x => x.id), b.map(x => x.id),
    '同输入必须产出同 id，否则收藏库去重会失效');
});

test('toFavoriteItems：name 优先用节点标题，meta 字段齐全', () => {
  const items = toFavoriteItems(mapCardsToNodes(normalizeChatToolPayload(cardPayload())));
  assert.equal(items[0].name, '会话A · 片段一');
  assert.equal(items[0].meta.convTitle, '会话A');
  assert.equal(items[0].meta.role, 'user');
  assert.deepEqual(items[0].meta.tags, ['论文', '本周复盘']);
  assert.equal(items[0].meta.messageId, 'm_1');
  assert.equal(items[0].meta.favoriteAt, '2025-11-01T10:00:00');
});

test('toFavoriteItems：data 形状可直接喂给 restoreNode（含 origin）', () => {
  const items = toFavoriteItems(mapCardsToNodes(normalizeChatToolPayload(cardPayload())));
  const d = items[0].data;
  for (const k of ['kind', 'title', 'text', 'src', 'prompt', 'w', 'h']) {
    assert.ok(k in d, `data 缺字段 ${k}`);
  }
  assert.deepEqual(d.origin, {
    source: ORIGIN_SOURCE,
    messageId: 'm_1',
    convId: 'c_1',
    convTitle: '会话A',
    role: 'user',
    tags: ['论文', '本周复盘'],
    favoriteAt: '2025-11-01T10:00:00',
  });
});

test('toFavoriteItems：无 origin 的卡片也能转成收藏（messageId 为空）', () => {
  const raw = cardPayload();
  raw.draw_cards = [];
  const items = toFavoriteItems(mapCardsToNodes(normalizeChatToolPayload(raw)));
  assert.equal(items.length, 2);
  assert.equal(items[0].meta.messageId, '');
  assert.equal(items[0].data.origin, null);
});

test('toFavoriteItems：空输入返回空数组', () => {
  assert.deepEqual(toFavoriteItems([]), []);
});

// ---------------------------------------------------------------- 凭据
test('importFromChatTool 的 fetch 带 credentials:include（服务器 Basic Auth）', async () => {
  // 静态断言：这是运行时行为，跑真实请求需要 ChatTool 在线，故检查源码意图。
  // 理由：ChatTool 部署在 Nginx Basic Auth 之后，省略凭据会直接 401；
  //       同源时 include 与默认的 same-origin 等价，代价为 0。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../js/favorites.js', import.meta.url), 'utf8');
  const fnStart = src.indexOf('export async function importFromChatTool');
  assert.ok(fnStart > 0, '找不到 importFromChatTool');
  // 取到函数结束（下一个顶层 export 之前）
  const rest = src.slice(fnStart + 10);
  const nextExport = rest.indexOf('\nexport ');
  const body = nextExport > 0 ? rest.slice(0, nextExport) : rest;
  assert.match(body, /credentials:\s*['"]include['"]/,
    'importFromChatTool 的 fetch 必须带 credentials:include');
});
