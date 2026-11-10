# 悬浮面板：工具栏折叠 + 侧栏浮窗（floating-ui）

## 1. 需求

| # | 反馈 | 现状问题 |
|---|---|---|
| 1 | 底部工具栏要美化，最好折叠起来；「创建 / 切换画布 / 各种节点」不该都堆在底部 | 13 个控件贴在画布下缘，平板上还要横向滚动才能看到后面的按钮；画布可用高度被啃掉一条 |
| 2 | 工具栏、对话、大纲都做成**可拖拽的悬浮**形式 | 大纲/对话在文档流里，桌面端挤占画布宽度；窄屏是贴边抽屉，位置写死 |
| 3 | 实现**尽量简单** | 不引入布局框架、不做自由拉伸/吸附/多窗口管理 |

## 2. 设计

### 2.1 结构变化（index.html）

```
#stage
├── #canvasWrap            ← 唯一占满的容器（画布）
│   ├── #canvas …
│   ├── #toolbarFab        ← 新增：悬浮球（≡），点一下开/关工具栏
│   ├── #toolbar           ← 改成可折叠的悬浮面板（不再贴底横条）
│   ├── #outline           ← 从 #stage 直接子元素挪进来
│   ├── #sidebar           ← 同上
│   └── #canvasPanel
```

- 侧栏移入 `#canvasWrap` 后：`position: absolute`，**不占文档流**，画布始终满宽。
- 不再需要 `#toggleOutline` / `#toggleSidebar`（常驻浮窗本身可见）；折叠后由面板头部按钮重新展开。

### 2.2 悬浮球 + 可折叠工具栏（需求 1）

- 左下角一枚悬浮球 `#toolbarFab`（圆形，44px，`shadow-2`）。
- 点击 → 工具栏面板从球旁边展开/收起（`#toolbar.folded`），状态存 `localStorage.mc.toolbarCollapsed`。
- 展开后的面板：
  - 头部 `.tb-head`：标题「工具」+ 折叠按钮 `×`（点它收回）。
  - 内容分组不变（新建 / 文件 / 画布 / 数据 / 运行），但改为**纵向紧凑网格**，宽度固定 300px 左右，
    平板上不再横向滚动。
  - **同样可拖拽**：拖头部移动面板；位置与侧栏共用同一套持久化。
- 默认值：桌面展开，窄屏（≤1024px）折叠 —— 把屏幕还给画布。

### 2.3 可拖拽浮窗（需求 2）

统一实现 `bindFloatingPanel(el, { handle, key })`：

| 行为 | 规则 |
|---|---|
| 拖拽 | `pointerdown` 在 handle 上 → `pointermove` 改 `left/top`（相对 `#canvasWrap`） |
| 夹紧 | 松手时把面板夹进 `#canvasWrap` 可见区内（至少留 80×40 可见），窗口 resize 时也重新夹紧 |
| 持久化 | `localStorage.mc.floating[key] = {x, y}`，加载时恢复 |
| 折叠 | `el.collapsed` → 内容区 `display:none`，只留头部（对话/大纲/工具栏共用） |
| 不触发 | handle 上的按钮（`.drawer-close`、`.ol-tab`）不启动拖拽；拖拽中禁止选中文本 |

- 大纲 / 对话：默认停靠左上 / 右上；底部两角留给工具栏与视图控件。
- 对话默认宽度 340px、最大高度 `calc(100% - 140px)`；大纲 260px。不做拉伸（保持简单）。
- 层级：浮窗 `z-index: 40`，工具栏 `30`，悬浮球 `31`；`#canvasPanel` / `#favPanel` 仍在其上。

### 2.4 删除的旧机制

- 窄屏 78vw 抽屉 + `body:has(...) #toggleOutline{display:none}` 那一整套坑（旧注释已记录三次撞车）——彻底删掉，
  浮窗本身就在可见区内，不再有「收起后回不来」的问题。
- `#olClose` / `#sbClose` 语义改为「折叠此浮窗」（不是「挪出屏幕」）。

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `bindFloatingPanel(el,{handle,key})` / `bindFab(btn,panel)` / `bindToolbar()` |
| 数据 | 不改画布 JSON；新增两个 UI 偏好键：`mc.floating`、`mc.toolbarCollapsed` |
| 日志 | `DBG.log('浮窗拖动', key, {x,y})`、`DBG.log('工具栏折叠', folded)` |
| 兜底 | localStorage 读写异常 → 静默使用默认位置；解析失败 → 丢弃；面板拖出视口 → 夹紧 |

## 4. 影响面

- `index.html`：DOM 结构调整（侧栏移入 canvasWrap、新增 fab / 工具栏头部）
- `styles.css`：侧栏改 absolute、工具栏改悬浮面板、删除窄屏抽屉段
- `js/floating.js`（新增）
- `js/main.js` / `js/chat.js`：去掉旧 toggle 逻辑，接入新绑定
- **不改**：画布数据、连线、执行、收藏、导入导出

## 5. 刻意不做

- 面板缩放（拖边改大小）、吸附对齐、多面板自动避让 —— 复杂度高、收益低。
- 移动端手势（双指拖面板）—— 与画布双指缩放冲突，保持单指拖头部。
- 工具栏内容重排（把创建/切换挪进「菜单层级」）—— 本次只做折叠 + 悬浮，分类不变，避免一次改太多。
