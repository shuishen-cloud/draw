# ChatTool 拉取先进收藏列表手动导入 + 修复窄屏侧栏展开后收不回

## 背景

`chattool-cards` 阶段交付的「📥 从 ChatTool 拉取」是**直接落画布**的：
点一下，收藏全部变成卡片铺到当前画布上。实测使用后暴露两个问题。

### 问题 1：拉取缺少「预览—选择—落地」这一环

用户的心智模型是「**先看看有什么，再决定放哪些**」。直接落画布有两个副作用：

- 画布被突然填充，位置在已有内容右侧，容易把本来整理好的布局推乱；
- 拉错了要一张张删；而删掉后 `origin.messageId` 也没了，再拉一次会全部重来。

收藏面板本身已经是「查阅优先、导入其次」的设计（见 `doc/feat/favorites-node.md`），
拉取的结果应当先进这个列表，而不是绕开它直插画布。

### 问题 2：窄屏（≤1024px）侧栏展开后收不回去

`#toggleOutline` / `#toggleSidebar` 是展开/收起侧栏的唯一的入口。层级关系是：

| 元素 | z-index |
|---|---|
| `#outline` / `#sidebar`（窄屏下 `position:absolute` 浮层） | **50** |
| `#toggleOutline` / `#toggleSidebar`（`left/right: 16px; top: 16px`） | **31** |

31 < 50，而按钮的位置正好落在浮层侧栏的头部区域（`.ol-tabs` / `.sb-head`）上。
于是展开之后，按钮被侧栏**盖住**，点击命中侧栏而不是按钮 —— 表现为
「展开后点不动、收不回来」。

已在真实浏览器复现（900×700）：

```
toggleOutline 命中元素: toggleOutline      ← 折叠态，可点
展开后再点:  <span data-tab="outline" class="ol-tab active"> 拦截了指针事件
```

桌面（1280×800）侧栏在文档流内、不覆盖按钮，所以不复现——这是**只在窄屏/平板出现的 bug**。

## 设计方案

### A. 拉取改为「入收藏库」

拉取不再调用 `appendCanvasData`，而是把 ChatTool 的卡片写成收藏条目：

```
FavoriteItem {
  id, kind: 'chattool',
  name,                       // 会话标题 · 片段
  createdAt,
  meta: { convTitle, role, tags[], messageId, favoriteAt, chars },
  data: {                     // 与 node 收藏的 data 形状保持一致
    kind: 'doc'|'output'|'img'|'exec',
    title, text, src, prompt, w, h,
    origin: { source:'chattool', messageId, convId, convTitle, role, tags[], favoriteAt },
  }
}
```

存入既有 `items` 表（IndexedDB；降级 localStorage），与 `node` / `subgraph` 并列。
**完全不碰画布**——`state.nodes` 不变，`view` 不变，不触发 autosave。

### B. 收藏面板支持 `chattool` 类型

- 列表项展示：来源会话、角色、标签、字数、收藏时间；
- 预览区复用 Markdown 渲染（`data.text`）；
- 逐条「⬇ 导入到画布」：`restoreNode(id, viewportCenterWorld())`，走既有路径；
- 面板头部「⬇ 全部导入」：一次把列表里所有 `chattool` 条目落到画布。

### C. 去重口径

上一版按 `origin.messageId` 与**画布节点**比对。现在粒度变成收藏库：

- 拉取时按 `messageId` 与**收藏库已有条目**比对，重复的跳过（提示「跳过 N 条（已在收藏里）」）；
- 导入到画布时仍用 `appendCanvasData` 那套 `dedupeByMessageId`（对比画布节点），
  避免同一张卡在画布上出现两次。

两处去重职责不同，不能合并：收藏库是「收件箱」，画布是「工作台」。

### D. 修 z-index

窄屏媒体查询里把两个按钮提到 `z-index: 51`（高于侧栏 50）。
只改层级，不动位置与外观，因此桌面端视觉零变化。

## 数据流

```
点「📥 从 ChatTool 拉取」
  → fetch /api/favorites/draw
  → normalizeChatToolPayload + mapCardsToNodes      （chattool.js，已有）
  → toFavoriteItems                                  （新增：映射成收藏条目）
  → 按 messageId 与收藏库比对去重
  → store.put(items) 写库
  → refreshFavoritesPanel()  ← 列表里出现 N 条「来自 ChatTool」
  → 画布保持不变

用户点「⬇ 导入」(单条) 或「⬇ 全部导入」
  → restoreNode / appendCanvasData
  → 画布上出现卡片，带 origin
```

## 测试方式

### 单元（`tests/test_chattool.mjs` 增补）

- `toFavoriteItems(descs)`：`kind='chattool'`；`name` 取会话标题+片段；`meta` 字段齐全；
  `data.origin` 与 `data` 形状可供 `restoreNode` 直接使用。

### e2e（`tests/e2e_chattool_append.cjs` 改）

- 拉取后：**画布节点数不变**、收藏库条目增加、列表出现 chattool 项；
- 重复拉取：收藏库不增加，提示跳过；
- 「全部导入」后：画布节点数增加，且卡片带 `origin.messageId`；
- 再导入一次：不重复添加。

### 新增 e2e（`tests/e2e_toggle_zindex.cjs`）

- 900×700 视口：`elementFromPoint` 命中 `#toggleOutline` / `#toggleSidebar` 自身；
- 点两次大纲按钮：先 `collapsed` 再恢复；
- 点两次对话按钮：同上。

## 对现有系统的影响

- `appendCanvasData` 保留（「全部导入」仍走它），`chattool-cards` 的单测不受影响。
- 收藏库新增 `kind='chattool'`：`listFavoriteNodes()` 的过滤条件要放开该类型，
  否则新条目不会出现在列表里。
- 窄屏 z-index 只影响层级，不影响桌面布局。

## 限制

- 拉取到收藏库不自动同步：ChatTool 里取消收藏后，收藏库里的条目仍在（需手动删）。
- 收藏库是 localStorage 降级路径时，卡片正文过大可能触顶（与既有 node 收藏一致）。

## 实现与校验结果

### 落地清单

| 文件 | 改动 |
|---|---|
| `js/chattool.js` | 新增 `favoriteIdOf()`（由 messageId/内容派生**稳定 id**）、`toFavoriteItems()`（描述 → 收藏条目） |
| `js/favorites.js` | 新增 `pullChatToolToFavorites` / `listChatToolFavorites` / `clearChatToolFavorites` / `importAllChatToolFavorites`；`importFromChatTool` 改为入收藏库；`listFavoriteNodes` 放开 `chattool` 类型；列表与预览支持 chattool；`restoreNode` 透传 `origin` |
| `js/main.js` | 顶层 `HOST.closeDrawerOthers()`（窄屏抽屉互斥）；`#olClose` 绑定；`#toggleOutline` 打开时触发互斥 |
| `js/chat.js` | `#toggleSidebar` 同样触发互斥；import `HOST` |
| `index.html` | 收藏面板「⬇ 全部导入」按钮；侧栏头部抽屉 ✕（`#olClose` / `#sbClose`） |
| `styles.css` | 窄屏：展开时外部 toggle 让位、抽屉 ✕ 显示、`#sbClose` 提到 `z-index:61` 浮于收藏面板之上 |

### 使用方式

1. `cd ../ChatTools && .venv/bin/python -m app`（8765）
2. `node server.js` → 打开 **http://localhost:8090**
3. 侧栏「⭐ 收藏」→「📥 从 ChatTool 拉取」→ 卡片进入**左侧收藏列表**（画布不变）
4. 列表里点某条 → 预览 →「⬇ 导入到画布」；或直接点「⬇ 全部导入」

窄屏（≤1024px）下两侧栏是抽屉：展开一个自动收起另一个，用头部「✕」关闭。

### 校验结果

```
tests/test_chattool.mjs          25 pass / 0 fail    （+6：toFavoriteItems）
tests/test_geom.mjs              12 pass / 0 fail
tests/test_md.mjs                21 pass / 0 fail
tests/test_zone.mjs              12 pass / 0 fail
tests/e2e_chattool_append.cjs    32 通过 / 0 失败    （+[8][9][10]：收件箱链路）
tests/e2e_toggle_zindex.cjs      69 通过 / 0 失败    （新增，4 种宽度）
tests/e2e_canvases_logic.cjs     37 通过 / 0 失败
tests/e2e_favorites_node.cjs     41 通过 / 0 失败
tests/e2e_favorite_subgraph.cjs  45 通过 / 0 失败
tests/e2e_multi_canvas.cjs       28 通过 / 0 失败
```

真实端到端（ChatTools 8765 + draw 8090，两条收藏消息，900×700 视口走真实 UI 点击）：

```
拉取前画布 2 节点
拉取      → 「✅ 已收进收藏 2 条…」 画布仍 2 节点，列表出现 2 行（含《会话名》· 角色 · 标签）
重复拉取  → 「已是最新，2 条都在收藏里」
全部导入  → 「✅ 已导入 2 张卡片到画布」，画布 4 节点，origin.messageId 正确
重复导入  → 「已在画布上，跳过 2 张」，仍 4 节点
窄屏 ✕    → collapsed: true
浏览器错误 → 无
```

### 侧栏收起按钮：三次迭代才收敛的坑

这个问题比预想的难，记下来避免重犯：

| 尝试 | 做法 | 失败原因 |
|---|---|---|
| ① 原状 | `#toggleOutline` `z-index:31`，侧栏浮层 `z-index:50` | 按钮位置恰在侧栏头部，**被盖住**，`elementFromPoint` 命中 `.ol-tab` → 展开后收不回 |
| ② 提层级 | 提到 `z-index:51` | 反过来**盖住侧栏内容**，「⭐ 收藏」「清空」点不到 |
| ③ 随动平移 | `transform: translateX(侧栏宽)` | 900px 可用；**420px 下两按钮自己重叠**（侧栏 78vw） |
| ④ **最终** | 承认窄屏侧栏是**抽屉**：展开时外部 toggle 用 `:has()` 隐藏，由侧栏内「✕」收起；两抽屉**互斥** | — |

关键认知：窄屏下两侧栏各占 `78vw`，同时展开 = `156vw`，**必然互相遮挡**。
所以互斥不是凑合，而是这个布局下唯一自洽的交互。

补充一个连带的坑：收藏面板 `#favPanel` 是 `inset:0; z-index:60`，会盖住侧栏头部的 ✕。
把 `#sbClose` 提到 `z-index:61` 并绝对定位到侧栏右上角，保证「面板打开时仍能收起整个侧栏」。

### 测试方法论教训

`elementFromPoint` 断言必须**等 CSS transition 结束**。侧栏切换是 `transform .22s`，
class 同步切换但元素还在滑动，此时取中心点常落在视口外，返回 `none` —— 看起来像
「z-index 没生效」，实际是探针时机错了。`waitCollapsed()` 里加了 `waitForTimeout(260)`。

### 与上一版的关系

- `appendCanvasData`（`chattool-cards`）**保留**：「全部导入」仍走它，它自带的
  「与画布节点按 messageId 去重」正好防重复。
- 默认入口语义变了：点「拉取」不再直接画到画布，而是**进收藏列表**。
