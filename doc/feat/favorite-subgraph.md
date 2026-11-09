# 收藏图：框选子图（favorite-subgraph）

## 1. 目标

> 「收藏图」= 收藏**一张图里的一些节点和边**，而不是整张画布。

三种操作，按优先级：

1. **框选**：拖出一个矩形，收纳框内节点。
2. **查阅**：面板里只读预览这块子图（列表 + 缩略结构），不碰画布。
3. **导入**：把子图还原到当前画布，**全部重新分配 id**，内部边正确重连。

## 2. 为什么是框选

用户的原话是「一些节点和边」。框选直接对应这个直觉：

- 不需要先建立图论概念（连通分量、1 跳邻居）
- 已有画布拖动/缩放的坐标体系可直接复用（`screenToWorld`）
- 选区就是用户想表达的边界，无需二次确认

## 3. 关键算法

### 3.1 框选与闭包裁剪

```js
pickSubgraph(rect, nodes, edges) -> { nodes, edges, bounds }
```

规则：

- 节点进选区：节点的 **矩形与选区有交集**即算命中
  （不用「完全包含」，否则用户必须框得很大才收得进去）
- 边进选区：**`source` 与 `target` 都已在选区内**才保留

第二条是关键。若不裁剪，跨框的边会被一起导出，导入后
`importCanvasData()` 里的 `if (!state.nodes[e.source] || ...) continue`
会**静默丢弃**它——用户看到的是「收藏时明明有线，导入后没了」。

`bounds` 是选区内容的包围盒，用于预览与导入时居中。

### 3.2 id 重映射

```js
remap(snapshot, idFactory) -> { nodes, edges }
```

- 每个节点 id 都换成**新 id**，旧→新建一个 `Map`
- 每条边的 `source/target` 按 Map 重写
- 无法映射的边（理论上不会出现，但防御性处理）整条丢弃

为什么必须换 id：收藏的是**过去的快照**，画布上可能已经存在同 id 的节点
（甚至就是原节点本身）。复用 id 会导致状态表键冲突、DOM id 重复、
连线指向错误节点。

### 3.3 导入居中

子图按 `bounds` 平移，使其中心落在传入的 `pos`（当前视口中心）：

```
dx = pos.x - (bounds.x + bounds.w / 2)
dy = pos.y - (bounds.y + bounds.h / 2)
```

每个节点的 `x/y` 加上 `dx/dy`。这样导入的位置与原始相对布局一致。

## 4. 数据模型

收藏项（`items` 表）：

```js
{
  id: 'f...',
  kind: 'subgraph',
  name: '框选 3 节点',
  createdAt: '...',
  meta: { nodeCount: 3, edgeCount: 2, hasImage: false },
  data: {
    nodes: [{ id, kind, title, x, y, w, h, text, prompt, zoneId, level, srcKey? }],
    edges: [{ id, source, target, command }],
    bounds: { x, y, w, h }
  }
}
```

图片节点沿用 `favorites-node` 的做法：`srcKey` 指向 `blobs` 表，
元数据里不内联 base64。降级到 localStorage 时改为内联 `src`。

## 5. 交互

| 步骤 | 行为 |
|---|---|
| 点工具栏「⬚ 框选收藏」 | 进入框选模式（鼠标变十字，画布上方出现提示条） |
| 在画布空白处拖拽 | 绘制半透明选框 |
| 松手 | 命中 ≥1 节点 → 直接收藏并 toast「已收藏 N 节点 / M 连线」；0 节点 → toast 提示 |
| `Esc` / 再次点按钮 | 取消框选模式 |

框选模式下**屏蔽画布平移**与节点拖动，避免手势冲突（复用现有 `spaceDown` 的判定方式）。

## 6. 预览

面板预览区显示：

- 头部：名称 + 「N 节点 / M 连线」+ 「⬇ 导入到画布」
- 列表：每个节点一行（类型标签 + 标题 + 内容摘要）
- 每条边一行：`标题A → 标题B（命令）`

用**文本结构**而不是渲染缩小版画布：缩略图在多节点时会糊成一团，
文本列表既能查阅又能直接读到 AI 输出的全文摘要。

## 7. 异常与兜底

| 场景 | 处理 |
|---|---|
| 框内 0 节点 | 不收藏，toast「框选区域内没有节点」 |
| 框内只有 1 个节点 | 允许收藏（kind 仍为 `subgraph`，无边） |
| 边指向框外节点 | 裁剪丢弃（闭包保证不会出现） |
| 图片 Blob 缺失 | 导入空白图片节点 + `DBG.warn` |
| 导入时 id 冲突 | 强制新 id，绝不复用 |
| 收藏数据损坏（缺 nodes） | 预览显示「数据损坏」，可删除 |

## 8. 测试

`tests/e2e_favorite_subgraph.cjs`：

1. `pickSubgraph` 单元语义：框内节点全收；**跨框的边被丢弃**
2. 框选 0 节点 → 不产生收藏
3. 框选成功 → `items` 新增一条 `kind==='subgraph'`，`meta` 计数正确
4. 导入 → 节点数 +N；**所有新 id 与旧 id 都不相同**
5. 导入 → 边数 +M，且每条边的两端都指向新节点（无悬空）
6. 导入位置：子图中心落在传入 `pos` 附近
7. 图片节点子图：`blobs` 有条目，导入后 `src` 可用
8. 全程无 JS 异常

## 9. 影响面

- 纯新增模块 `js/subgraph.js`，不改现有节点/连线数据结构。
- `favorites.js` 增两条路径；面板预览按 `kind` 分支。
- `build.js` 的 `ORDER` 需加入 `subgraph.js`（漏加会被现有校验拦下）。
- 现有节点收藏行为不变（`favorite-node` 的 41 项断言须保持全绿）。

---

## 10. 实现与校验结果

### 10.1 落地清单

| 文件 | 改动 |
|---|---|
| `js/subgraph.js`（新增） | `pickSubgraph()`（框选 + 闭包裁剪）、`boundsOf()`、`centerOffset()`；纯逻辑，不碰 DOM |
| `js/favorites.js` | `favoriteSubgraph()` / `loadSubgraphSnapshot()` / `restoreSubgraph()`；子图预览分支；`importFavorite()` 自动区分单节点/子图；列表项显示「子图 · N 节点 / M 连线」 |
| `js/main.js` | `bindSubgraphSelect()`：进入框选模式、拖出选框、松手收藏、`Esc` 退出 |
| `index.html` | 工具栏 `#favSubgraph`、`#selectHint` 提示条、`#selectBox` 选框 |
| `styles.css` | 十字光标、选框虚线遮罩、提示条、子图预览样式 |
| `build.js` | `ORDER` 加入 `subgraph.js`（漏加会被既有校验直接拦下） |

### 10.2 fix 阶段修掉的问题

1. **导入后连线全丢**（高）：见下节「关键教训」。
2. **e2e 假失败**：以画布左上角为拖拽起点时，实际命中 `#toggleOutline`
   浮动按钮，`pointerdown` 没到 canvas。用 `elementFromPoint` 定位、改从内容中心起手。

### 10.3 关键教训：新 id 必须来自 createNode 的实际分配

最初想用 `remap(snapshot, idFactory)` 预先分配 id 再按映射表连线，结果：

```
工厂预分配 n3/n4  →  createNode 内部 ++seq 又加一次  →  实际创建 n5/n6
addEdge('n3','n4') →  state.nodes['n3'] 不存在  →  边被静默跳过
```

表现为「收藏时明明有线，导入后一条都不剩」。正确做法是
**先 `createNode` 拿真实返回 id，边用真实 id 重连**。
`remap()` 因此没有调用方，已删除——生产代码不留死路径。

闭包裁剪则相反，必须留在**收藏侧**：`importCanvasData()` 对端点缺失的边是
`continue` 静默跳过，若把跨框边存进去，用户只会看到连线无声消失。

### 10.4 测试结果

```
node --test tests/*.mjs            45 通过，0 失败
tests/e2e_favorite_subgraph.cjs    45 通过，0 失败   ← 本次新增
回归：ux_fixes 21 · zone_auto 32 · node_scroll 21 · md_render 46
      touch_link 17 · tablet_run 37 · dev_mode 10 · dev_cache 15
      canvases_logic 37 · multi_canvas 28 · add_doc_empty 13
      favorites_node 41
```

全量 **402 项断言，0 失败**。

### 10.5 使用方式

1. 点工具栏「⬚ 框选收藏」→ 鼠标变十字、画布顶部出现提示条。
2. 拖出一个矩形框住想要的节点，松手即收藏。
   **只保留两端都在框内的连线**，跨框的线会被裁掉。
3. 侧栏「⭐ 收藏」→ 点该条 → 看到节点列表与 `A → B（命令）` 的连线结构。
4. 点「⬇ 导入到画布」→ 在当前视口中心还原，**全部重新分配 id**，
   内部连线按新 id 正确重连，边命令保留。
5. `Esc` 或再点一次按钮退出框选模式。

### 10.6 已知限制

- 框选按「与选区相交」判定，无法只选「完全包含在框内」的节点（无 modifier 切换）。
- 不做区域（zone）的迁移：子图里节点的 `zoneId` 保留原值，导入到没有该区域的画布时
  会显示为「未分类」，不会自动建区域。
- 框选模式与画布平移互斥（有意为之，避免手势冲突）。
- 画布左上角区域被「📑 大纲」浮动按钮占用，从那里起手框选会点到按钮。
- 子图预览是文本结构，不是缩小版画布缩略图（多节点时后者不可读）。
- **AI 输出的收藏**沿用节点收藏（方案 C），不单独提供「只收藏输出文本」的入口。
