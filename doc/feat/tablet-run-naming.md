# 平板运行优化 + 卡片命名（tablet-run-naming）

## 1. 问题

### 1.1 平板上无法运行

当前所有运行入口都依赖键盘或鼠标：

| 入口 | 操作 | 平板可用 |
|---|---|---|
| 运行单条连线 | 编辑标签后 `Alt+Enter` | ❌ 无 Alt 键 |
| 运行选中连线 | `Alt+Enter` | ❌ 无键盘 |
| 运行执行节点 | **双击**标题 | ⚠️ 触摸双击与拖动冲突，且会触发缩放 |
| 全部运行 | 点工具栏「全部运行 ▶」 | ✅ |

后果：平板上基本只能「全部运行」，无法单独触发某个节点/连线。

### 1.2 没有进度与取消

`runAll` 串行执行所有连线与执行节点：

```js
for (const e of ordered) await runEdge(e.id);
for (const n of execs) await runExecNode(n.id);
```

- 无进度提示，节点多时看起来像卡死；
- 无法中途取消，误触后只能等它跑完（每条都要调 LLM，可能几分钟）。

### 1.3 卡片无法命名

标题在创建时按类型写死：

```js
const titles = { output: '输出', img: '图片', doc: '文档', exec: '执行' };
title: opts.title || titles[kind] || '节点',
```

除导入文件会带文件名外，手动创建的节点一律叫「文档」「输出」。多个同类节点在大纲与对话快照里无法区分。

## 2. 设计

### 2.1 卡片命名：标题就地编辑

- 标题（`.node .title`）改为 `contenteditable`，**双击进入编辑**。
- `Enter` 或失焦保存，`Esc` 取消。
- 空标题回退为默认名（按 `kind`）。
- 保存时 `DBG.log` + `scheduleSnapshot()`；`title` 是已有字段，导出格式不变。

**冲突处理**：标题同时是拖动抓手。用「双击进入编辑」区分：

| 手势 | 行为 |
|---|---|
| `pointerdown` + 移动 | 拖动节点 |
| `pointerdown` + 抬起（未移动） | 选中节点 |
| 双击 | 进入标题编辑 |
| 编辑中 | 不触发拖动（`contenteditable` 内的 pointerdown 已被 bar 排除） |

### 2.2 运行按钮（触摸可达）

**工具栏**新增 `▶ 运行选中`：运行当前选中的连线或执行节点。选中状态在平板上可靠（单击即选中）。

**执行节点标题栏**新增 `▶` 按钮：点一下即运行该节点（等价于原来的双击标题）。保留双击作为桌面快捷方式。

**连线**：点标签选中后点「▶ 运行选中」；保留 `Alt+Enter`。

### 2.3 进度与取消

`runAll` 改为支持进度上报与取消令牌：

```js
export async function runAll(opts = {}) {
  const signal = opts.signal;              // { aborted: boolean }
  const total = ordered.length + execs.length;
  let done = 0;
  for (const e of ordered) {
    if (signal?.aborted) break;
    setProgress(++done, total, describe(e));
    await runEdge(e.id);
  }
  ...
  setProgress(null);                       // 结束清除
}
```

- 进度显示在工具栏「全部运行」按钮上：`运行中 3/7`，并变成「✕ 取消」。
- 取消后：**已完成的保留结果**，未开始的不动。
- 运行中的节点加 `.running` class（边框脉冲），让用户看到当前在跑哪个。

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `renameNode(node, title)`；`runAll({ signal })`；`runNodeById(id)` |
| 数据模型 | `node.title` 既有字段，语义改为用户可编辑；运行状态为瞬态（`node.running`、`state.runProgress`），**不持久化** |
| 日志 | `DBG.log('重命名', id, old, '->', new)`；`DBG.log('运行进度', done, '/', total)`；`DBG.log('运行已取消')` |
| 兜底 | 空标题回退默认名；取消时不做额外副作用；无 API Key 提前 alert |

## 4. 影响面

- `js/nodes.js`：标题编辑、执行节点 ▶ 按钮
- `js/run.js`：`runAll` 进度与取消
- `index.html`：工具栏加「运行选中」
- `styles.css`：标题编辑态、运行按钮、进度、`.running` 脉冲
- **不改**：导出格式、连线逻辑、Markdown 渲染、区域归属

## 5. 校验

### 5.1 端到端（`tests/e2e_tablet_run.cjs`）

1. 双击标题进入编辑态（`contenteditable=true`）
2. 输入新名字 + Enter → `node.title` 更新、DOM 同步
3. 空标题失焦 → 回退为默认名
4. `Esc` 取消编辑 → 原名字不变
5. 执行节点有 ▶ 按钮，点击触发运行（用 stub 拦截网络）
6. 工具栏有「运行选中」按钮
7. 选中连线后点「运行选中」→ 触发了该连线的运行
8. `runAll` 进度回调被调用，包含 total 与当前序号
9. 取消令牌生效：abort 后不再执行后续项
10. 运行中节点带 `.running` class，结束后移除
11. 重命名后导出数据里 `title` 是新名字

### 5.2 回归

既有 10 个套件全部通过。

## 6. 实现与校验结果

### 6.1 改动

| 文件 | 关键改动 |
|---|---|
| `js/nodes.js` | 标题 `bindTitleEdit`（双击编辑、Enter 保存、Esc 取消、失焦保存、空名回退）；导出 `renameNode`；执行节点标题栏加 `▶` 按钮（其它节点不渲染） |
| `js/run.js` | 新增 `runNodeById` / `runSelection` / `setRunning` / `setProgress`；`runAll({signal, onProgress})` 支持进度与取消 |
| `js/exec.js` | `runEdge` 给目标节点加/除 `.running` |
| `js/main.js` | 「全部运行」运行中变为取消入口；「▶ 运行选中」；平板断点 768 → 1024 |
| `js/viewport.js` | `fitToContent` 窄屏判定对齐 1024，底部留 80px |
| `styles.css` | `.run-node` 按钮、`.title.editing`、`.node.running` 脉冲、`#toolbar` 窄屏横滑、`#hint` 窄屏隐藏、断点 1024 |
| `index.html` | 工具栏加 `▶ 运行选中` |

### 6.2 平板运行入口对比

| 操作 | 之前 | 现在 |
|---|---|---|
| 运行执行节点 | 双击标题（与拖动冲突） | **点 ▶ 按钮**（也保留双击） |
| 运行某条连线 | `Alt+Enter`（无键盘不可用） | 选中连线 → **▶ 运行选中** |
| 全部运行 | 点按钮，无反馈 | 点按钮；**运行中显示 `运行中 3/7 ✕`**，再点即取消 |
| 当前在跑哪个 | 无提示 | 节点边框**橙色脉冲** + 连线虚线流动 |

### 6.3 校验结果

```
$ node tests/e2e_tablet_run.cjs        → 35 通过，0 失败
$ node tests/e2e_ux_fixes.cjs          → 21 通过
$ node tests/e2e_zone_auto.cjs         → 32 通过
（其余套件均无回归）
```

端到端覆盖：双击进入编辑、Enter 保存、Esc 取消、空名回退、导出持久化、
▶ 按钮触发运行、工具栏运行选中、runAll 进度递增到 total、取消后只执行部分、
运行中 `.running` 标记出现/清除、平板布局（工具栏宽度/高度/横滑/画布宽度/侧栏折叠）。

### 6.4 过程中发现并修复的真实缺陷

1. **工具栏被压成竖条**：`max-width: calc(100% - 32px - 260px)` 在画布可用宽度 < 292px 时为负，按钮逐字换行成一列竖排。改为 `max(240px, calc(...))` 保底，窄屏 `nowrap + overflow-x:auto` 横滑。
2. **平板断点覆盖不到**：侧栏浮层化与默认折叠的断点是 `768px`，而 iPad 竖屏 820px、横屏 1180px 都不触发，导致画布被两侧栏挤到只剩 180px。统一提到 **1024px**（CSS 与 JS 三处必须同步）。
3. **▶ 按钮无差别渲染挤爆标题栏**：所有节点都加运行按钮后，标题栏中心又落到控件上（`e2e_zone_auto` 的断言拓到）。改为只在执行节点渲染。

### 6.5 遗留

- **连线运行仍需先选中**：平板上点连线标签会很准，但仍有一步。可考虑长按连线弹快捷菜单（未做）。
- **进度只有数量，无节点名**：`运行中 3/7`。若要显示当前节点标题，需要把 `describe(edge)` 传进 `onProgress`。
- **取消是协作式的**：`signal.aborted` 在每项开始前检查，已在飞行中的请求不会被中断（避免半途截断结果）。
- 断点仍分散在 `styles.css` / `main.js` / `viewport.js`，已记 `controlled-exception`，后续改动需三处同步。
- 平板横屏 1180px > 1024，仍会走桌面布局（侧栏占位）。若需要，可再加一档横屏断点。
