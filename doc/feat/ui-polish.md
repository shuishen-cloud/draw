# 界面与交互美化（ui-polish）

## 1. 现状诊断（基于 1440 / 820 / 390 三档截图实测）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | **Emoji 图标渲染成豆腐块** `☒` / `◻` | 截图里「📑 大纲」「📂 导入文件」「💾 保存」「⬚ 框选收藏」「🗂 画布」全部是空方框 | 首屏观感最差的一处；`file://` 单文件版在无彩色 Emoji 字体的设备上必现 |
| 2 | **配色无体系** | `:root` 只有 5 个变量，且大量裸色值（`#eef0f3` `#333` `#eceef1`…）散落各处 | 改主题要全文件搜，悬停/激活层级靠手感 |
| 3 | **工具栏层级低** | 全是同一种灰胶囊，13 个按钮等权；主操作「▶ 运行选中」淹没其中 | 找不到重点 |
| 4 | **空画布无引导** | 首屏（无示例时）只有网格 | 新用户不知道第一步做什么 |
| 5 | **画布无桌面级快捷键** | 无 `Delete` 删除、无 `Ctrl/⌘+0/±` 缩放、无方向键微移、`Esc` 不取消选中 | 鼠标操作路径长，键盘用户几乎不可用 |
| 6 | **连线命令标签文案差** | 空命令显示 `+ 命令`，双击才可以编辑 | 不知道双击；「+」看起来像可添加 |
| 7 | **对话侧栏空态弱** | 只有助手一条欢迎语；快照区是裸 `<pre>` | 看不出「快照会随消息发送」这件事的结构 |
| 8 | **节点选中反馈薄** | 仅 3px 外发光，无「当前节点」次要标记 | 多节点时难以确认选中的是哪个 |

## 2. 设计

### 2.1 图标：不依赖 Emoji 字体（问题 1）

原则：**能用 CSS 画的用 CSS，不能的画内联 SVG**，绝不依赖彩色 Emoji。

- 按钮统一写法：`<button class="ghost"><i class="ic ic-save"></i>保存</button>`
- `.ic` 为 16×16 内联块，通过 `mask-image` + `currentColor` 着色（`--ic-*` 里存 `url("data:image/svg+xml,...")`），
  这样同一图标随按钮文字色自动变色，且**任何字体环境都能显示**。
- 左侧 Tab（大纲/任务）与标题栏图标同法。

> 兜底：`mask-image` 不支持时（极老浏览器）`.ic` 为空块，只损失图标不损失文字——
> 文字标签全部保留，可访问性不下降。

### 2.2 色彩 / 层级 token（问题 2、3、8）

新增三层变量，既有裸色值**逐步**映射，不做一次性大改：

```css
:root{
  /* 品牌 */
  --accent:#4f46e5; --accent-weak:#eef2ff; --accent-hover:#4338ca;
  /* 中性层级：surface(面) / subtle(次级面) / line(线) / ink(文字) */
  --surface:#fff; --subtle:#f6f7f9; --line:#e4e6eb;
  --ink:#1f2328; --ink-2:#5b6270; --ink-3:#8b919c;
  /* 语义 */
  --ok:#16a34a; --warn:#f59e0b; --danger:#dc2626;
  /* 阴影/圆角/动效 */
  --sh-1:0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08);
  --sh-2:0 4px 16px rgba(16,24,40,.10);
  --sh-3:0 12px 32px rgba(16,24,40,.16);
  --r-1:6px; --r-2:10px; --r-3:14px;
  --dur:.15s;
}
```

- 工具栏改**分组**：`新建组 | 文件组 | 导出组 | 运行组`，用 `.tb-sep` 竖线分隔；
  「▶ 运行选中」为 primary（实心 accent），其余 ghost。
- 选中态：`.node.selected` 增加一条左侧 3px accent 竖条（`::before`），与外发光叠加。
- 交互反馈统一 `transition: var(--dur)`；`prefers-reduced-motion` 已有关闭逻辑，保持。

### 2.3 空画布引导（问题 4）

`#canvas` 顶层新增只读空态层 `#emptyHint`：

- 条件：`state.nodes` 为空时显示；任一节点创建即隐藏（`createNode` 内触发 `HOST.syncEmptyHint()`）。
- 内容：标题「画布是空的」+ 三行入门动作 + 「＋ 文档节点」主按钮。
- `pointer-events`：整层 `none`，只有按钮 `auto`，避免拦截画布平移。

### 2.4 快捷键（问题 5）

新增 `js/shortcuts.js::bindShortcuts()`，只在 `init()` 里调一次：

| 键 | 行为 |
|---|---|
| `Delete` / `Backspace` | 删除选中节点（连带其连线）或选中的连线 |
| `Esc` | 取消选中；正在编辑时不拦截（编辑态自己处理） |
| `方向键` | 选中节点移动 1px；`Shift+方向` 10px |
| `Ctrl/⌘ + 0` | 缩放到 100% 并居中（等价 `1:1`） |
| `Ctrl/⌘ + =` / `-` | 以可见区中心放大/缩小 |
| `Ctrl/⌘ + A` | 全选？**不做**——多选未实现，避免误导（见 §5） |

**守卫**：目标为 `input/textarea/select/contentEditable` 时全部跳过；正在编辑连线命令/标题时跳过。

### 2.5 连线命令标签（问题 6）

空命令时文案 `+ 命令` → `… 点击编辑命令`（`title` 提示「双击编辑，如 总结 / 翻译」），
`placeholder` 类名保留（测试与样式依赖 `.placeholder`）。

### 2.6 对话侧栏（问题 7）

- 快照区加图标 + 结构化行（`节点 N 个 · 连线 M 条`），`pre` 加最大高度与滚动。
- 无消息时显示空态：三条示例问句作为**可点击**的 chip，点了填进输入框（不自动发送）。

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | 新增 `bindShortcuts()`；新增 `HOST.syncEmptyHint()`；其余不变 |
| 数据模型 | **无变化**，不新增持久化字段 |
| 日志 | `DBG.log('快捷键', action)` |
| 兜底 | 图标 `mask-image` 不支持 → 只丢图标；快捷键命中输入框全部跳过；空态层 `pointer-events:none` 只有按钮可点 |

## 4. 影响面

- `styles.css`（主要）：token、图标、工具栏分组、选中态、空态层
- `index.html`：按钮结构（`<i class="ic">`）、文案
- `js/shortcuts.js`（新增）、`js/main.js`（init 绑定 + 空态同步）
- `js/edges.js`：placeholder 文案
- `js/chat.js`：空态示例 chip
- **不改**：数据结构、导入导出格式、执行链路、连线几何

## 5. 刻意不做

- **多选 / 框选多节点**：需要引入 selection set 与批量拖拽，属于独立 feat。
- **暗色主题**：token 已具备条件，但暗色需要逐组件校对（SVG 连线、缩略图、图片棋盘格），单独排期。
- **全面替换所有裸色值**：只替换与本次改动相邻的部分，避免一个大 PR 里混入大量无语义 diff。

---

## 6. 实现与校验结果

### 6.1 落地清单

| 文件 | 改动 |
|---|---|
| `styles.css` | token 三层（brand/neutral/semantic + 阴影/圆角/时长）；`.ic` 图标系统（17 个 SVG mask）；`.tb-group/.tb-sep` 工具栏分组；`#emptyHint` 空态层；`#chatEmpty` chip；`.node::before` 选中竖条；`button:focus-visible`；`.edge-label.placeholder` 弱化 |
| `index.html` | 工具栏/侧栏/Tab 图标全部改 `<i class="ic">`；工具栏重组为 5 组；新增 `#emptyHint`、`#chatEmpty`；`<title>` 改为产品名 |
| `js/shortcuts.js`（新增） | `bindShortcuts()`：Delete/Backspace 删除、方向键微移（Shift ×10）、Esc 取消选中、Ctrl+0/Ctrl±、F 适应内容；入口统一 `inEditable()` 守卫 |
| `js/state.js` | 新增 `syncEmptyHint()` 并挂到 `HOST`/`window`（供任意模块触发，避免 import 成环） |
| `js/main.js` | `init` 里 `bindShortcuts()`、空态按钮绑定、首屏 `syncEmptyHint()`；删掉硬编码欢迎语，改由 `syncChatEmpty()` 呈现示例 chip |
| `js/nodes.js` / `js/io2.js` | 节点增删、画布导入后同步空态；`clearCanvas` 只删 `.msg` 不整片清空 |
| `js/chat.js` | `syncChatEmpty()` / `bindChatEmpty()`；点击 chip 只填充不发送；`addMsg` 后自动收起空态 |
| `js/edges.js` | 空命令标签文案 `+ 命令` → `点击写命令` + `title` 提示双击编辑 |
| `build.js` | `shortcuts.js` 加入 ORDER（在 main 之前） |
| `tests/shot.cjs`（新增） | 三档视口 + 空态/选中态截图脚本，供后续 UI 改动做视觉回归 |

### 6.2 校验结果

- `tests/e2e_ui_polish.cjs`：**36 通过 / 0 失败**
- 全量回归（16 个 e2e）：**全部 0 失败**（含 `e2e_multi_canvas` 因空态容器调整而修正的两处断言）

### 6.3 过程中发现并修复的问题

1. **分组破坏窄屏 sticky**：`#canvasPicker` 从 `#toolbar` 直接子元素变成 `.tb-group` 的子元素后，
   窄屏 `order:-1` / `position:sticky` 全部失效，切换器被横向滚动挤出可视区。
   修法：给包含切换器的组加 `#toolbar .tb-group:has(#canvasPicker){order:-1}`。
2. **`clearCanvas` 误删空态容器**：`#chatEmpty` 住在 `#msgs` 里，而 `clearCanvas`
   用 `msgs.innerHTML=''` 整片清空 → 首屏 `restoreCanvas()` 一执行空态容器就消失。
   改为只 `remove()` `.msg` 气泡。
3. **测试断言口径**：`#msgs.children.length` 会把空态容器算进「对话条数」，
   改为 `querySelectorAll('#msgs .msg').length`。

### 6.4 使用方式

- 桌面：`Delete` 删选中、方向键微移、`Esc` 取消选中、`Ctrl/⌘+0` 回到 100%、`Ctrl/⌘±` 缩放、`F` 适应内容。
- 空画布：中央引导卡片，只有「新建文档节点 / 导入文件」两个按钮吃指针事件，其余区域仍可拖动画布。
- 无消息时：侧栏出现三条示例问句 chip，点击填入输入框（不自动发送，避免误耗额度）。

### 6.5 已知限制

- 单文件版在**极老浏览器**（不支持 `mask-image`）上图标不可见，但文字标签全部保留，功能不受影响。
- `F` 快捷键在部分输入法组合键下可能被吞（中文输入法组字中），属预期行为。
- 窄屏（≤1024px）隐藏 `.tb-sep`，分组间距由 gap 承担。
