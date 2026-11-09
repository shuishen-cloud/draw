# 多画布：本地多份画布切换与管理（multi-canvas）

## 1. 背景

当前实现只有**一个**画布：`js/io2.js` 的自动保存与恢复写死 `localStorage['mc_canvas']`。
由此产生两个问题：

1. **无法同时保留多套图**。想对比「方案 A / 方案 B」只能导出文件再导入，来回覆盖。
2. **多标签页互相踩踏**。两个浏览器标签共用同一个键，后保存的直接覆盖先保存的，
   而且没有任何冲突提示（`server.js` 是无状态静态服务，不做会话隔离）。

目标：在**不引入后端**的前提下，把「一张画布」升级为「本地多画布仓库」，
支持新建 / 切换 / 重命名 / 复制 / 删除。

## 2. 设计

### 2.1 存储布局

| 键 | 内容 |
|---|---|
| `mc_canvases` | JSON 数组 `[{ id, name, updatedAt }]`，画布清单（元数据，不含正文） |
| `mc_canvas:<id>` | 单个画布的正文，即 `exportCanvasData()` 的 JSON 字符串 |
| `mc_active` | 当前画布 id |
| `mc_canvas`（旧） | 旧版单画布键，仅用于一次性迁移 |

把「清单」和「正文」分开，是为了让切换器只需要读一个小数组，
不必把每张画布（可能含 base64 大图）全部反序列化。

### 2.2 为什么不改成 `mc_canvas:<tabId>`

按标签页分键能解决覆盖，但那样每个标签页就永远看不到对方的数据，
也无法在同一个标签页里切换——和「多画布」的目标相反。
这里选择**画布 id** 作为键：切到同一张画布的两个标签页仍会互相覆盖（已知限制，
与当前行为一致，不倒退），但可以各自切到不同画布并行工作。

### 2.3 切换语义

```
switchCanvas(id):
  1. flushCurrent()     把当前内存画布写回「当前 id」的键（不等防抖）
  2. 更新 mc_active = id
  3. 读 mc_canvas:<id> → importCanvasData()；缺失则建空画布
  4. 刷新大纲 / 任务 / 快照 / 小地图
```

要点：**先落盘再切换**。自动保存有 500ms 防抖，若不 flush，
切换瞬间的编辑会丢。

### 2.4 迁移与兜底

- 启动时若 `mc_canvases` 不存在而旧键 `mc_canvas` 存在 → 迁移成第一张画布「默认画布」，
  成功后**保留**旧键（只读不删），失败则回退到旧逻辑，绝不丢图。
- 清单为空时自动创建一张空画布，保证「永远至少有一张」。
- 删除当前画布 → 自动切到剩余第一张；删除最后一张 → 先建空的再删。
- 存储超限（`QuotaExceededError`，通常是图片太大）→ 只 `DBG.warn` + toast，
  不抛出，不影响继续编辑。

## 3. 接口

```js
// js/canvases.js
listCanvases()                      -> [{ id, name, updatedAt }]
activeCanvasId()                    -> string
createCanvas(name)                  -> id      // 新建空画布并切换过去
switchCanvas(id)                    -> boolean // false = id 不存在
renameCanvas(id, name)              -> boolean
duplicateCanvas(id, name?)          -> id|null // 深拷贝正文，改名「X 副本」
removeCanvas(id)                    -> boolean
```

为便于测试，模块把存储抽象成可注入的 `storage`（默认 `window.localStorage`），
纯逻辑（清单增删改、迁移判定）不直接触碰 DOM。

`js/io2.js` 增加：

```js
flushCanvas()        // 立即把 exportCanvasData() 写回当前画布键（同步）
autosaveCanvas()     // 仍为 500ms 防抖，但写到「当前画布」键
restoreCanvas()      // 改为：ensure 仓库 → 载入当前画布（含旧数据迁移）
```

## 4. 界面

工具栏（`#toolbar`）新增两个控件，放在「💾 保存」旁边：

- `<select id="canvasPicker">`：列出全部画布，选中即切换。窄屏下 `flex:none; max-width:9em`。
- `<button id="canvasMenu">🗂 画布</button>`：弹出操作面板（新建 / 重命名 / 复制 / 删除）。

用原生 `select` 而不是自定义下拉：平板触摸友好、无需自己处理点击外部关闭，
且与现有 `#toolbar` 的横向滚动布局兼容。

## 5. 测试

1. `tests/test_canvases.mjs`（`node --test`）——纯逻辑，注入内存 storage：
   - 首次 `ensure` 有旧键 `mc_canvas` → 迁移为「默认画布」，正文不变
   - 无任何数据 → 创建空画布，`mc_active` 被写入
   - `create / rename / duplicate / remove` 的清单与 active 变化
   - 删除当前画布后 active 指向剩余画布
   - `switchCanvas('不存在')` 返回 false 且不改 active
2. `tests/e2e_multi_canvas.cjs`（Playwright，跑构建产物）：
   - 初始只有一张画布；新建第二张后画布为空（示例节点不出现）
   - 切回第一张能恢复节点
   - 重命名后 `<select>` 里文字更新，刷新页面仍是新名字
   - 删除当前画布后自动落到剩余画布

## 6. 影响面

- 存储键布局变化；旧用户首次打开自动迁移，不丢数据。
- `mc_tasks`（任务）仍是全局的，不随画布切换——本次不处理，记入已知限制。
- `build.js` 的 `ORDER` 需加入 `canvases.js`（依赖 `state.js`、`io2.js`），
  否则单文件离线版会缺函数。
