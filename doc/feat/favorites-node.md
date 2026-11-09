# 收藏节点：IndexedDB 存储 + 查阅 + 导入画布（favorites-node）

## 1. 目标

1. **收藏节点**：把画布上某个节点冻结成一条只读收藏。
2. **查阅优先**：点开收藏项先看到只读预览（Markdown 渲染 / 图片直显），不直接改动画布。
3. **导入其次**：预览里点「导入到画布」，在**当前视口中心**生成一个可用节点。
4. 不做分类索引系统（无标签、无全文搜索、不查重）。

## 2. 为什么用 IndexedDB（且不引入 localForage）

| 约束 | localStorage | IndexedDB |
|---|---|---|
| 容量 | 5–10 MB | 数百 MB（受磁盘配额） |
| 写入 | 同步阻塞主线程 | 异步 |
| 图片 | 只能 base64（+33% 膨胀） | 可直接存 `Blob` |

图片节点的 `src` 是 base64，单个通常 1–3 MB。用 localStorage 收藏几张就撞
`QuotaExceededError`，而且 `setItem` 同步序列化大 JSON 会卡输入。

项目坚持**零第三方依赖**（无 `package.json`、`build.js` 手写拼接、有离线单文件产物），
因此不引入 localForage/Dexie，而是写一层**薄封装**：只暴露本项目需要的
`open/put/get/getAll/delete`，不造通用 ORM，也不自创奇怪的 schema 惯例。

## 3. 数据模型

### 3.1 IndexedDB

```
数据库 mc-fav，version 1
├─ store 'items'   keyPath 'id'
│    index 'kind'      -> kind
│    index 'createdAt' -> createdAt
│    {
│      id: 'f1',
│      kind: 'node',
│      name: '文档-人工智能',
│      createdAt: '2026-01-01T00:00:00Z',
│      meta: { nodeKind:'doc', hasImage:false, chars:1234 },
│      data: { title, kind, text, prompt, w, h, srcKey? }
│    }
└─ store 'blobs'   keyPath 'key'
     { key: 'fb-f1', blob: Blob, type: 'image/png' }
```

要点：**元数据与图片分表**。列表页只读 `items`（几百字节），
只有在查阅/导入某一条时才去 `blobs` 取图。

### 3.2 localStorage 降级

IndexedDB 打不开时（隐私模式、部分 `file://` 环境）：

```
mc_fav_items -> [ { ...同 items，但 data.src 内联 dataURL } ]
```

此时容量受限，写入超限要**明确提示**并建议删除旧收藏或导出。

## 4. 接口

```js
// js/store.js —— 薄封装，storage 可注入便于测试
openStore()                      -> Promise<Store>
Store.put(storeName, value)      -> Promise<void>
Store.get(storeName, key)        -> Promise<any|undefined>
Store.getAll(storeName)          -> Promise<any[]>
Store.delete(storeName, key)     -> Promise<void>
Store.backend                    -> 'idb' | 'local'

// js/favorites.js
favoriteNode(nodeId, name?)      -> Promise<string|null>   // 返回收藏 id
listFavoriteNodes()              -> Promise<item[]>        // 按 createdAt 倒序
getFavorite(id)                  -> Promise<{item, blobUrl}>
removeFavorite(id)               -> Promise<boolean>
restoreNode(id, {x, y})          -> Promise<string|null>   // 返回新节点 id
```

`restoreNode` 的落点：调用方传入**当前视口中心**换算出的 world 坐标；
节点宽高沿用收藏时的大小，并做夹紧（避免尺寸为 0 的异常数据）。

## 5. 交互设计

| 入口 | 行为 |
|---|---|
| 节点标题栏 `⭐` | 收藏该节点，立即 toast 提示 |
| 侧栏 `⭐ 收藏` 按钮 | 打开收藏面板 |
| 面板列表项点击 | 预览区显示只读内容（Markdown / 图片） |
| 预览区「导入到画布」 | 在视口中心生成新节点并选中 |
| 面板列表项 `🗑` | 删除该收藏（二次确认） |

预览区是**只读**的：复用 `renderMarkdown()`，不挂 `contenteditable`。

## 6. 需要先修的前置问题

`js/nodes.js::selectNode()` 目前**只切 CSS class，不写任何状态**：

```js
export function selectNode(id) {
  Object.values(state.nodes).forEach(n => n.el.classList.toggle('selected', n.id === id));
}
```

没有「当前选中节点」就无法做「收藏选中节点」。本次补 `state.selectedNodeId`，
并在 `selectNode` 中维护（同时保证删除节点时清空）。

## 7. 异常与兜底

| 场景 | 处理 |
|---|---|
| IndexedDB 不可用 | 自动降级 localStorage，`DBG.warn` + 首次提示 |
| 两种存储都不可用 | 收藏按钮置灰并提示「当前环境不支持本地存储」 |
| localStorage 超限 | 明确提示：删旧收藏 / 改用导出；不静默失败 |
| 图片 Blob 丢失 | 导入为空白图片节点，`DBG.warn`，不抛错 |
| 收藏的节点已被删除 | 面板照常显示（快照已冻结），导入不受影响 |
| 收藏数据损坏（缺 data） | 预览显示「数据损坏」，仍允许删除 |

## 8. 测试

`tests/e2e_favorites_node.cjs`（Playwright，真实浏览器跑 IndexedDB）：

1. 收藏一个文档节点 → `items` 里出现 1 条，`kind==='node'`
2. 列表按时间倒序，`meta.nodeKind` 正确
3. 查阅：预览区出现该节点的 Markdown 渲染结果（如标题、列表）
4. 导入：画布节点数 +1，新节点文本与被收藏一致，落点在视口中心附近
5. 图片节点往返：收藏后 `blobs` 有 1 条，导入后 `img.src` 是 blob/data URL 且能解码
6. 删除收藏：`items` 与 `blobs` 都被清除
7. 降级：stub `indexedDB.open` 抛错，`Store.backend === 'local'`，收藏仍可用
8. 全程无 JS 异常

## 9. 影响面

- 新增两个模块；`build.js` 的 `ORDER` 必须加入（已有「漏加即报错」校验）。
- 不改动任何现有 localStorage 键（`mc_canvas:*`、`mc_tasks`、`mc_canvases`）。
- `state.selectedNodeId` 属新增字段，现有代码不读它，无回归风险。
- 离线单文件版需重新 `node build.js`。

---

## 10. 实现与校验结果

### 10.1 落地清单

| 文件 | 改动 |
|---|---|
| `js/store.js`（新增） | IndexedDB 薄封装：`openStore()` + `put/get/getAll/delete/clear`；`backend` 暴露 `'idb'|'local'`；3s 打开超时；`blobToDataURL/dataURLToBlob` 供降级路径 |
| `js/favorites.js`（新增） | `favoriteNode / listFavoriteNodes / getFavorite / removeFavorite / restoreNode`；收藏面板（`openFavoritesPanel / refreshFavoritesPanel / showFavorite / importFavorite / bindFavorites`）；`viewportCenterWorld()` |
| `js/state.js` | 新增 `state.selectedNodeId` |
| `js/nodes.js` | `selectNode()` 同步维护 `selectedNodeId`；`removeNode()` 清空；标题栏加 `.fav-node`（⭐）；拖动排除列表加入该按钮 |
| `js/main.js` | `bindFavorites()`；注入 `HOST.favoriteNodeById`（避免 nodes ↔ favorites 循环依赖） |
| `index.html` | 侧栏加 `#openFavorites` 按钮与 `#favPanel`（列表 + 预览） |
| `styles.css` | 收藏面板样式；`.fav-node` 绝对定位到左侧圆点，不占 flex 空间 |
| `build.js` | `ORDER` 加入 `store.js`、`favorites.js` |

### 10.2 fix 阶段修掉的问题

1. **并发收藏丢数据**（高）：`newFavId()` 用「时间戳 + 进程内序号」，
   两个标签页同一毫秒收藏会生成相同 id，后写覆盖先写。
   → 改用 `crypto.randomUUID()`，不可用时回落「时间戳+随机数+序号」。
   新增 `[8]` 双标签页并发断言。
2. **`main.js` 缺 `HOST` 导入**（高）：单文件构建把它掩盖了（同一作用域已有 `HOST`），
   只有 `e2e_dev_mode` 的原生 ES Module 路径暴露 `ReferenceError`。
3. **⭐ 挤压标题栏**：导致 `e2e_zone_auto` 的「标题栏中心不落在交互控件上」回归。
   → 改为 `position: absolute` 贴左侧圆点，`hover/selected` 时才显现。

### 10.3 测试结果

```
node --test tests/*.mjs          45 通过，0 失败
tests/e2e_favorites_node.cjs     41 通过，0 失败   ← 本次新增
回归：ux_fixes 21 · zone_auto 32 · node_scroll 21 · md_render 46
      touch_link 17 · tablet_run 37 · dev_mode 10 · dev_cache 15
      canvases_logic 37 · multi_canvas 28 · add_doc_empty 13
```

全量 **357 项断言，0 失败**。

### 10.4 使用方式

- **收藏**：节点标题栏左侧的 ⭐（hover/选中时显示）；或选中节点后点侧栏「⭐ 收藏」。
- **查阅**：侧栏「⭐ 收藏」打开面板 → 点列表项看只读预览（Markdown 已渲染 / 图片直显）。
- **导入**：预览区右上「⬇ 导入到画布」，节点落在**当前视口中心**并自动选中。
- **删除**：列表项右侧 🗑（二次确认，同时清理 `items` 与 `blobs`）。

### 10.5 已知限制

- 收藏是**快照**：之后修改原节点不会同步到已收藏项，反之亦然。
- 降级到 localStorage 时容量约 5 MB，带图收藏容易超限，会明确报错并建议删除旧收藏。
- 暂无重命名收藏、暂无标签/搜索（按约定不做分类索引）。
- 收藏面板挂在侧栏内，窄屏需先展开对话栏（`≡ 对话`）。
- **「收藏图」尚未实现**，按约定作为下一条 feat。
