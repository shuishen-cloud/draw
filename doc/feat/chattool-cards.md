# ChatTool 传送的收藏作为画布卡片（拉取式追加导入）

## 背景

上层的 `../ChatTools`（对话脉络管理器，Python + Starlette，默认 `127.0.0.1:8765`）
已经实现了「分享收藏到 draw」：

- `GET /api/favorites/draw` → `{ok: true, data: <画布 JSON>}`
- `GET /api/favorites/draw.json` → 裸画布 JSON（带 `Content-Disposition` 下载）
- 画布 JSON 格式与 draw 的 `exportCanvasData()` 一致：
  `{format:'mutiplechat-canvas', version:1, view, nodes[], edges[], zones[], tasks[]}`
- 额外携带 `draw_cards[]` 元信息：`{nodeId, messageId, convId, convTitle, role, tags[], favoriteAt, source}`
- CORS 白名单已放行本机任意端口（`http://localhost:*` / `http://127.0.0.1:*`）

也就是说**数据格式这一层不需要改**。真正缺的是 draw 侧的接入口径。

## 问题：现有导入是「整板替换」，不能用来接卡片

`io2.js::importCanvasData()` 第一件事就是 `clearCanvas()`：

```js
export function importCanvasData(data) {
  if (!data || data.format !== 'mutiplechat-canvas') throw new Error(...);
  HOST.__silentImport = true;
  try {
    clearCanvas();          // ← 整块画布清空
    ...
```

这对「打开一个画布文件」是正确的，但对「把对话框里收藏的几条消息放成卡片」是灾难：
用户正在画的图会被直接抹掉。

另外 `draw_cards` 里的来源信息（`messageId` / `convTitle` / `tags` / `favoriteAt`）
在现有导入流程里被完全忽略 —— 卡片落地后无法回答「这张卡是从哪条消息来的」，
也就无法去重（同一条收藏拉两次会出现两张一模一样且互相不知道的卡片）。

## 设计目标

1. **只追加，不清空**：把 ChatTool 的数据变成「往当前画布上再放几张卡片」。
2. **来源可溯**：卡片节点上保留 `origin` 元信息，大纲/预览里能看出出处。
3. **幂等**：同一条收藏重复拉取只生成一张卡片，第二次报「已存在，跳过」。
4. **失败可自救**：ChatTool 没启动时给出明确提示，并指出退路（导出 JSON 再 ⬆ 导入）。
5. **不回归**：现有 ⬆ 导入 / 收藏面板行为完全不变。

## 方案

### 1. 新增纯逻辑模块 `js/chattool.js`

把「解析 + 映射 + 排布 + 去重」做成不碰 DOM 的纯函数，这样能用
`node --test` 直接测（与 `geom.js`、`subgraph.js` 的既有做法一致）。

| 函数 | 职责 |
|---|---|
| `normalizeChatToolPayload(raw)` | 解包 `{ok, data}`；校验 `format === 'mutiplechat-canvas'`；把 `draw_cards` 按 `nodeId` 索引成 Map。返回 `{nodes, edges, cards}`。缺 `format` 抛错。 |
| `mapCardsToNodes(payload)` | 把外部 node + 对应 card 合成「本地待建节点描述」：`{kind, title, text, x, y, w, h, origin}`。`kind` 不在 `doc/output/img/exec` 白名单时回落 `doc`。 |
| `planLayout(descs, existingNodes, origin?)` | 3 列网格排布，起点在**已有节点最右/最下之外**，避免叠在现有卡片上。返回已写好 x/y 的描述数组。 |
| `dedupeByMessageId(descs, existingNodes)` | 按 `origin.messageId` 与画布上已有节点的 `origin.messageId` 比对，剔除重复项，返回 `{kept, skipped}`。没有 `messageId` 的（如自由笔记）不做去重。 |

### 2. `io2.js` 新增 `appendCanvasData(data)`

```js
export function appendCanvasData(data) {
  // 与 importCanvasData 的区别：不清空、不重置 seq、不动 view
  // 1) normalize + 映射 + 去重 + 排布
  // 2) 逐个 createNode（kind 白名单）
  // 3) 边只连两端都已存在的新/旧节点
  // 4) refreshOutline / redrawEdges / refreshSnapshot / autosaveCanvas
  return { added, skipped };
}
```

要点：

- **不动 `view`**：用户当前看到什么就还看到什么（导入后不跳视角，只把新卡片放在视野附近）。
- **不动 `seq`**：`createNode` 自己递增，追加不该重置计数器（重置会导致 id 撞车）。
- **边**：ChatTool 目前只发卡片不发边，但仍按通用规则处理——端点找不到就 `DBG.warn` 跳过。

### 3. `node.origin` 字段

`createNode()` 增加可选 `origin`，透传到 `state.nodes[id].origin`。
`exportCanvasData()` 一并导出，`importCanvasData()` 一并还原，保证「保存 → 重开」后去重仍然有效。
旧画布数据没有这个字段 → 按 `null` 处理，向后兼容。

### 4. 入口：收藏面板的「📥 从 ChatTool 拉取」

`favorites.js` 面板头部加一个按钮，点击后：

```
fetch('http://127.0.0.1:8765/api/favorites/draw')
  → json.ok ? json.data : 抛错
  → appendCanvasData(data)
  → toast: 新增 X 张，跳过 Y 张（已存在）
```

URL 允许覆盖（默认本机 8765），便于用户改端口：

```js
const CHATTOOL_DRAW_URL = 'http://127.0.0.1:8765/api/favorites/draw';
```

失败分支：

- `TypeError` / `Failed to fetch` → 「ChatTool 未启动（127.0.0.1:8765）？或改用 ⬇ 导出 → ⬆ 导入」
- `ok:false` → 显示后端 `error`
- 返回 0 张卡片 → 「ChatTool 里还没有收藏」

## 数据流

```
ChatTool UI ──GET /api/favorites/draw──► {ok:true,data:{...}}
                                              │
                                   normalizeChatToolPayload
                                              │
                                   mapCardsToNodes (附 origin)
                                              │
                              dedupeByMessageId (对比画布已有)
                                              │
                          planLayout (3 列网格，落在已有内容之外)
                                              │
                                   appendCanvasData (追加建节点)
                                              │
                        state.nodes + autosaveCanvas → 画布上多出 N 张卡片
```

## 测试方式

### 单元测试 `tests/test_chattool.mjs`（node --test）

- `normalizeChatToolPayload`：解 `{ok,data}` 包裹；裸数据也接受；缺 `format` 抛错；`draw_cards` 正确索引。
- `mapCardsToNodes`：`kind` 白名单回落；`title` 缺失时回落到会话标题；`origin` 字段完整；无对应 card 的节点 `origin` 为 `null`。
- `dedupeByMessageId`：同 `messageId` 只保留一个；无 `messageId` 全保留；已有画布上的卡片会被识别为重复。
- `planLayout`：网格 3 列；起点避开已有节点包围盒；不产生重叠。

### e2e `tests/e2e_chattool_append.cjs`（Playwright）

- 画布上先有 1 个节点 → 追加 2 张卡片 → 断言共 3 个节点（**未被清空**）。
- 再追加同一份 → 断言仍 3 个节点，且返回 `skipped=2`。
- 断言卡片节点的 `origin.messageId` 已写入。

## 对现有系统的影响

- `importCanvasData` 语义**不变**，所有现有 e2e 应保持通过。
- 新增 `node.origin` 为可选字段；`exportCanvasData` 多导出一个键，旧数据导入时缺省 `null`。
- 单文件版需把 `chattool.js` 加进 `build.js` 的 `ORDER`（否则会 ReferenceError，`build.js` 已有漏模块检查会拦住）。
- 纯新增 UI 按钮，不影响既有收藏面板交互。

## 限制

- 需要 ChatTools 服务在跑；纯离线单文件版（`file://`）下 `fetch` 本机端口会被 CORS/混合内容限制，需走导出文件兜底。
- 不做双向同步：ChatTool 里取消收藏后，画布上的卡片不会自动消失（这是刻意的——用户可能已改过卡片内容）。
