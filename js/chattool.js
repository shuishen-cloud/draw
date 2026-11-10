// =========================================================================
// chattool.js —— 接住上层 ChatTools 传送过来的画布数据（收藏卡片）
//
// 数据来源：ChatTool 的 GET /api/favorites/draw
//   返回 {ok:true, data:{format:'mutiplechat-canvas', version:1,
//                        nodes[], edges[], zones[], tasks[], draw_cards[]}}
//   （/api/favorites/draw.json 则是解包后的裸数据）
//
// 本模块只做纯逻辑：解包 → 映射成本地节点描述 → 去重 → 网格排布。
// 不碰 DOM、不写 globalThis，故可被 node --test 直接测试。
// 真正建节点在 io2.js::appendCanvasData。
// =========================================================================

// ChatTool 的收藏导出接口。
//
// 为什么不能写死 127.0.0.1：这个地址的语义是「**打开页面的这台设备自己**」，
// 不是「ChatTool 所在的那台机器」。ChatTool 部署到服务器后：
//   - 电脑打开 draw → 127.0.0.1 指向用户自己的电脑（没跑 ChatTool）→ 连接被拒
//   - 手机打开 draw → 127.0.0.1 指向手机自己 → 必然失败
// 请求根本没离开用户设备，而报错又会说「请确认 ChatTool 已启动」，把人带偏。
// 故按 location 推断：
//   服务器部署  → 同源 <origin>/8000/api/favorites/draw（走 Nginx，同源无 CORS）
//   本机开发    → http://127.0.0.1:8765（与原来完全一致）
//   file:// 单文件版 → 同上（与原来完全一致）

export const LOCAL_CHATTOOL_DRAW_URL = 'http://127.0.0.1:8765/api/favorites/draw';

// ChatTool 的部署子路径，与 ChatTools 仓库的 CHATTOOL_PREFIX 对应。
// 抽成常量集中耦合：换路径只改这一行。
export const CHATTOOL_PREFIX = '/8000';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * 根据 location 推导 ChatTool 收藏导出地址。
 *
 * loc 是 { protocol, origin, hostname } 形状（传 location 本身即可）。
 * 抽出纯函数的理由：tests 在 node --test 下跑，根本没有 location；
 * 注入后可以覆盖全部形态，无需 mock 全局。
 */
export function resolveChatToolUrl(loc) {
  // 没有 location（node 测试）/ 非 http(s)（file:// 单文件版）→ 本机
  if (!loc || (loc.protocol !== 'http:' && loc.protocol !== 'https:')) {
    return LOCAL_CHATTOOL_DRAW_URL;
  }
  // 本机开发：draw 跑在 :8090，ChatTool 在 :8765。
  // 这里必须回退到 8765 而不是同源 + /8000 —— server.js 没有那条路由。
  if (!loc.hostname || LOCAL_HOSTS.has(loc.hostname)) return LOCAL_CHATTOOL_DRAW_URL;
  // 部分环境 origin 为空 → 拼出来是 "undefined/8000/..."，不如回退
  if (!loc.origin) return LOCAL_CHATTOOL_DRAW_URL;
  return loc.origin + CHATTOOL_PREFIX + '/api/favorites/draw';
}

export const CHATTOOL_DRAW_URL = resolveChatToolUrl(
  typeof location !== 'undefined' ? location : null);

// 画布支持的节点类型；外部数据里的 kind 必须落在这个白名单内
export const KINDS = ['doc', 'output', 'img', 'exec'];

// origin.source 取值
export const ORIGIN_SOURCE = 'chattool';

// 卡片排布参数：3 列网格
export const GRID_COLS = 3;
export const CELL_W = 300;
export const CELL_H = 160;
export const GAP_X = 60;
export const GAP_Y = 60;
export const ORIGIN_X = 160;
export const ORIGIN_Y = 160;

const DEFAULT_W = 300;
const DEFAULT_H = 160;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 解包并校验 ChatTool 的返回体。
 *
 * 接受两种形状：
 *   {ok:true, data:{...}}   ← /api/favorites/draw（HTTP 接口）
 *   {format:'mutiplechat-canvas', ...}  ← /api/favorites/draw.json（下载版）
 *
 * 返回 {nodes, edges, cards}，cards 是 nodeId -> draw_card 的 Map。
 * 非法输入一律抛错（调用方负责提示用户）。
 */
export function normalizeChatToolPayload(raw) {
  if (raw && raw.ok === false) {
    throw new Error(raw.error || 'ChatTool 返回失败');
  }
  // 解一层 {ok, data} 包裹
  const body = raw && raw.ok === true && raw.data ? raw.data : raw;

  if (!body || typeof body !== 'object' || body.format !== 'mutiplechat-canvas') {
    throw new Error('不是有效的画布数据（缺少 format=mutiplechat-canvas）');
  }

  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];

  const cards = new Map();
  for (const c of Array.isArray(body.draw_cards) ? body.draw_cards : []) {
    if (c && c.nodeId) cards.set(String(c.nodeId), c);
  }

  return { nodes, edges, cards };
}

/**
 * 外部节点 + draw_card → 本地「待建节点描述」。
 * 不分配 id（交给 createNode），只整理字段与 origin 元信息。
 */
export function mapCardsToNodes(payload) {
  const { nodes, cards } = payload;
  return nodes.map((n) => {
    const card = cards.get(String(n.id)) || null;
    const origin = card ? {
      source: ORIGIN_SOURCE,
      messageId: card.messageId || '',
      convId: card.convId || '',
      convTitle: card.convTitle || '',
      role: card.role || '',
      tags: Array.isArray(card.tags) ? [...card.tags] : [],
      favoriteAt: card.favoriteAt || '',
    } : null;

    const rawKind = String(n.kind || '');
    const kind = KINDS.includes(rawKind) ? rawKind : 'doc';
    // 标题优先级：节点自带 > 会话标题 > 兜底
    const title = String(n.title || origin?.convTitle || '收藏');

    return {
      srcId: String(n.id ?? ''),      // 外部节点 id，供 io2 建边时映射
      kind,
      title,
      text: String(n.text ?? ''),
      src: String(n.src ?? ''),
      prompt: String(n.prompt ?? ''),
      w: num(n.w, kind === 'img' ? 240 : DEFAULT_W),
      h: num(n.h, kind === 'img' ? 200 : DEFAULT_H),
      origin,
    };
  });
}

/**
 * 按 origin.messageId 去重。
 *
 * 两类重复都要拦：
 *   1) 与「画布上已有节点」重复（重复点同一按钮）
 *   2) 同一批内部重复（ChatTool 侧数据异常）
 * 没有 messageId 的卡片（如自由笔记）不去重，避免被静默吞掉。
 *
 * 返回 {kept, skipped}。
 */
export function dedupeByMessageId(descs, existingNodes = []) {
  const seen = new Set();
  for (const n of existingNodes) {
    const mid = n?.origin?.messageId;
    if (mid) seen.add(String(mid));
  }
  const kept = [];
  const skipped = [];
  for (const d of descs) {
    const mid = d?.origin?.messageId;
    if (mid && seen.has(String(mid))) { skipped.push(d); continue; }
    if (mid) seen.add(String(mid));
    kept.push(d);
  }
  return { kept, skipped };
}

/**
 * 网格排布：新卡片整体放在「已有节点的包围盒之外」，
 * 避免直接压在用户正在看的卡片上。
 */
export function planLayout(descs, existingNodes = []) {
  if (!descs.length) return [];

  const list = Array.isArray(existingNodes) ? existingNodes.filter(Boolean) : [];

  let baseX = ORIGIN_X;
  let baseY = ORIGIN_Y;
  if (list.length) {
    let maxRight = -Infinity;
    for (const n of list) {
      const r = (Number(n.x) || 0) + num(n.w, DEFAULT_W);
      if (r > maxRight) maxRight = r;
    }
    if (Number.isFinite(maxRight)) baseX = maxRight + GAP_X;
  }

  return descs.map((d, i) => {
    const w = num(d.w, DEFAULT_W);
    const h = num(d.h, DEFAULT_H);
    const x = baseX + (i % GRID_COLS) * (CELL_W + GAP_X);
    const y = baseY + Math.floor(i / GRID_COLS) * (CELL_H + GAP_Y);
    return { ...d, w, h, x, y };
  });
}

// =========================================================================
// 收藏条目（收件箱模式）
// =========================================================================
// 拉取到的卡片不直接落画布，而是先写成收藏条目（kind='chattool'），
// 用户在收藏面板里预览、逐条或批量导入。理由见 doc/feat/chattool-inbox.md：
// 「先看有什么、再决定放哪些」比「一下子铺满画布」更可控。
//
// id 必须**可重现**：由 messageId 派生，同一张卡重复拉取能命中同一个 id，
// 收藏库的去重才成立。不能用时间戳或自增序号。

/**
 * 由 messageId 生成稳定的收藏 id。
 * 没有 messageId（自由笔记）时退回内容摘要，同内容仍能去重。
 */
export function favoriteIdOf(desc) {
  const mid = desc?.origin?.messageId;
  const basis = mid ? 'm:' + mid : 't:' + (desc?.title || '') + '|' + (desc?.text || '');
  // 简易 32 位哈希（FNV-1a），够用于「同一张卡得同一 id」
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'fct-' + h.toString(36) + '-' + basis.length.toString(36);
}

/**
 * 待建节点描述 → FavoriteItem（与 node 收藏的 data 形状对齐，
 * 以便 restoreNode 直接复用）。
 */
export function toFavoriteItems(descs) {
  if (!Array.isArray(descs) || !descs.length) return [];
  const now = new Date().toISOString();
  return descs.map((d) => {
    const origin = d.origin || null;
    const snippet = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 18);
    const name = d.title || origin?.convTitle || snippet || 'ChatTool 卡片';
    return {
      id: favoriteIdOf(d),
      kind: 'chattool',
      name,
      createdAt: now,
      meta: {
        convTitle: origin?.convTitle || '',
        role: origin?.role || '',
        tags: origin?.tags || [],
        messageId: origin?.messageId || '',
        favoriteAt: origin?.favoriteAt || '',
        chars: (d.text || '').length + (d.prompt || '').length,
      },
      data: {
        kind: d.kind,
        title: name,
        text: d.text || '',
        src: d.src || '',
        prompt: d.prompt || '',
        w: d.w,
        h: d.h,
        origin,
      },
    };
  });
}
