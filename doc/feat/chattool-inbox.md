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
