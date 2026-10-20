# 体验修复：默认预览与四个交互缺陷（ux-fixes）

## 1. 问题清单

| # | 问题 | 现象 | 根因 |
|---|---|---|---|
| 1 | Markdown 预览默认关闭 | 用户不知道有该功能；看到源码以为"没渲染" | `renderNode` 初始 `dataset.mode = 'edit'` |
| 2 | 默认示例是纯文本 | 即便点了预览也看不出变化 | 示例文档 `人工智能正在改变世界…` 无任何 Markdown 语法 |
| 3 | `#hint` 遮挡工具栏按钮 | 点「1:1」「缩放」等无反应 | `#hint` 浮在 `#toolbar` 上，拦截 pointer 事件（实测 `intercepts pointer events`） |
| 4 | 「1:1」缩放锚点偏移 | 点完节点跑出视野 | `reset1` 以整块画布中心为锚，但侧栏占位后可见区中心偏移 |
| 5 | 图片节点点分类会弹选图 | 点标题栏的分类下拉 / 删除，弹出文件选择器 | 文件选择 `click` 监听绑在整个 `.node` 上，冒泡触发 |

## 2. 设计

### 2.1 默认预览（问题 1、2）

- `doc` / `output` / `exec` 节点创建后**默认 `mode = 'preview'`**。
- `img` 节点无文本 → 保持 `edit`（且不显示切换按钮）。
- 默认示例文档改为带语法的 Markdown，让用户打开即看到渲染效果：

```markdown
# 人工智能

大语言模型可以：

- 写代码
- 做翻译
- **总结**长文

> 它们从海量文本中学到了语言的统计规律。
```

- 切换按钮文案随之调整：预览态显示「编辑」，编辑态显示「预览」（已有逻辑，无需改）。

### 2.2 图片节点选图只绑内容区（问题 5）

```js
// 之前：整个节点
el.addEventListener('click', () => { /* 打开文件选择 */ });

// 之后：只绑图片内容区
body.addEventListener('click', () => { /* 打开文件选择 */ });
```

同时给标题栏内的交互元素（`.zone-pick`、`.close`、`.md-toggle`）加 `stopPropagation`，双保险。

> 注意：`body` 内的 `drag/drop/paste` 监听保持不变（它们本就只针对内容区）。

### 2.3 `#hint` 不拦截指针（问题 3）

```css
#hint { pointer-events: none; }   /* 纯说明文字，永远不该吃点击 */
```

### 2.4 缩放锚点用可见区中心（问题 4）

`reset1` 改为按 `#canvasWrap`（画布可见容器）的中心计算，而不是 `#canvas`：

```js
const r = document.getElementById('canvasWrap').getBoundingClientRect();
zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / view.scale);
```

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `setNodeMode(node, mode)` 签名不变；默认调用改为 `'preview'` |
| 数据模型 | **不新增持久化字段**；`dataset.mode` 默认值由 `edit` 改为 `preview`，不写入导出 JSON |
| 日志 | `DBG.log('默认预览', nodeId)` |
| 兜底 | `img` 节点不支持预览 → 保持 `edit`；渲染异常仍降级为转义纯文本 |

## 4. 影响面

- `js/nodes.js`：默认模式、图片节点选图绑定、示例文本
- `js/main.js`：示例节点 Markdown、`reset1` 锚点
- `js/viewport.js`：必要时导出可见区中心辅助函数
- `styles.css`：`#hint` 的 `pointer-events`
- **不改**：数据结构、导入导出格式、连线逻辑、执行逻辑

## 5. 校验

### 5.1 端到端断言（`tests/e2e_ux_fixes.cjs`）

1. 打开页面，`doc` / `output` / `exec` 节点 `dataset.mode === 'preview'`，`.md-view` 可见
2. 默认示例文档含 Markdown 语法，预览态渲染出 `<h1>` + `<ul>`
3. 点击 `.zone-pick` **不**触发文件选择（拦截 `input[type=file].click`）
4. 点击 `.close` 不触发文件选择
5. `#hint` 的 `pointer-events === 'none'`
6. 工具栏按钮可点击（元素在点击位置命中自身，不被遮挡）
7. 点「1:1」后节点仍在可见区域内
8. 图片节点仍可通过点击内容区选图（功能保留）

### 5.2 回归

- 既有 5 个测试套件全部通过（geom 12 / md 21 / node-scroll 21 / md-render 45 / touch-link 17 / port-clash 16）

## 6. 实现与校验结果

### 6.1 改动

| 文件 | 关键改动 |
|---|---|
| `js/nodes.js` | `renderNode` 末尾（`node.el` 赋值**之后**）对 doc/output/exec 调 `setNodeMode(node,'preview')`；图片节点的选图 `click` 从 `el` 改为 `body`；`.zone-pick` 加 `click` 的 `stopPropagation`；`setNodeMode` 的静默 `return` 改为 `DBG.warn` |
| `js/main.js` | 示例文档换成带标题/列表/引用的 Markdown；`zoomIn/zoomOut/reset1` 锚点改用 `viewCenter()`（`#canvasWrap`） |
| `js/viewport.js` | 新增 `visibleRect()` 与 `centerContent()`；`fitToContent` 改用可见区、窄屏 padding 20、预留底部 130px、缩放上限 1.0 |
| `styles.css` | `#hint { pointer-events: none }`；`#viewctl` z-index 提到 22 且窄屏移到顶部；`#toolbar` 让出右侧空间 |
| `tests/e2e_node_scroll.cjs` | 显式切回 edit 态（该套件考察编辑态滚动） |
| `tests/e2e_md_render.cjs` | 同上，段 [3] 显式从 edit 开始 |
| `tests/e2e_ux_fixes.cjs` 🆕 | 21 项断言 |

### 6.2 校验结果（实测）

```
$ node tests/e2e_ux_fixes.cjs
[1] 页面加载          ✔ 无 JS 异常
[2] 默认预览          ✔ mode=preview  ✔ .md-view 可见  ✔ .body 隐藏  ✔ 按钮=「编辑」
[3] 示例 Markdown    ✔ 含语法  ✔ 渲染出标题  ✔ 渲染出列表
[4] 图片点分类        ✔ 不触发选图（count=0）
[5] 图片点内容区      ✔ 触发选图（count=1）
[6] #hint            ✔ pointer-events: none
[7] 工具栏            ✔ 按钮均未被遮挡
[8] 1:1 缩放          ✔ scale=1  ✔ 节点仍在可见区
[9] 模式往返          ✔ edit  ✔ preview
[10] 无异常           ✔ 全程无 JS 异常
结果：21 通过，0 失败
```

全量回归（153 项）：

```
tests/test_geom.mjs         → 12 passed
tests/test_md.mjs           → 21 passed
tests/e2e_node_scroll.cjs   → 21 通过
tests/e2e_md_render.cjs     → 45 通过
tests/e2e_touch_link.cjs    → 17 通过
tests/e2e_port_clash.cjs    → 16 通过
tests/e2e_ux_fixes.cjs      → 21 通过
```

额外复核（`review.cjs` 临时脚本）：

```
新建节点默认态: doc=preview, output=preview, img=edit, exec=preview
拖动标题栏后:   preview → preview（不误切）
编辑→预览往返:  h2=1, strong=1，源码完好
导出数据:      version=1，不含 "mode" 字段（向后兼容）
图片节点点分类: 选图触发 0 次
```

### 6.3 过程中踩的坑

1. **`setNodeMode` 静默 return 掩盖 bug**：它首行是 `if (!node.el) return`，而我把「默认预览」放在了 `node.el = el` 赋值**之前**。结果：功能完全不生效、无任何报错。已改为 `DBG.warn`，并把调用移到赋值之后。
2. **工具栏与视图控件重叠**：`#toolbar` 与 `#viewctl` 同在 `bottom:16px` 且同 z-index，窄屏下 toolbar 换行变高就盖住右侧缩放按钮。`elementFromPoint` 实测命中的是容器而非按钮。
3. **`fitToContent` 用错坐标系**：`canvasEl()` 是 `inset:0` 全屏层，侧栏占位后中心不等于可见区中心；`padding=60` 在 390px 窄屏上占比过大，算出 36% 缩放。
4. **改默认值会打破既有测试**：`e2e_node_scroll` 与 `e2e_md_render` 假设初始为编辑态。这是**有意的行为变更**，所以修测试（显式 `setNodeMode(n,'edit')`）而不是回退功能。

### 6.4 遗留

- 预览态不持久化：刷新后重新按默认规则推导（有内容即预览），符合直觉。
- `server.js` 仍无 `Cache-Control`，开发时改代码需强刷（独立问题，未在本 feat 范围）。
- 窄屏下底部工具栏仍占 130px，节点多时可视区会偏小。
