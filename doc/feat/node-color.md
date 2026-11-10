# 命令前后选择 + 卡片配色（node-color）

## 1. 需求与问题

| # | 反馈 | 现状 |
|---|---|---|
| 1 | 插入节点时，一般是**对既有信息先做一步处理，再走原来的命令**；应提供「插入到命令前 / 命令后」两个选项 | `insertNodeOnEdge` 写死「命令留在上游」：`A →(总结) X →(空) B`。也就是新节点**排在命令之后**，用户想「先摘要再总结」时还得手动改两条线的命令 |
| 2 | 每个卡片要有**颜色选项** | 节点只有按 `kind` 固定的点色（doc 绿 / output 黄 / exec 紫），无法人工标注（比如把「实验分支」标红） |

## 2. 设计

### 2.1 插入位置：before / after（需求 1）

两种语义，**默认 before**（更常见）：

| 位置 | 结果 | 含义 | 适合 |
|---|---|---|---|
| `before`（默认） | `A →(空) X →(原命令) B` | 新节点**在命令之前**：先处理原始信息，再交给原命令 | 「先摘要，再总结」——原始信息先被处理 |
| `after` | `A →(原命令) X →(空) B` | 新节点**在命令之后**：原命令先作用于 A，结果进 X | 「先总结，再润色」——已有结果再加工 |

- `planInsertOnEdge(src, dst, edge, { position })` 返回 `upstreamCommand` / `downstreamCommand` 两个字段，
  由 `position` 决定命令放在哪一段。
- 非法 `position` 一律按 `'before'` 处理（向前兼容）。

**入口**（三处都要能选）：
- 右键连线菜单：`在命令前插入节点` / `在命令后插入节点`
- 标签上 `＋` 按钮：**点击弹出同一个二级菜单**（原先是直接插）
- `Insert` 键：默认 `before`；`Shift+Insert` 为 `after`

### 2.2 卡片配色（需求 2）

**调色板**（6 色 + 默认），取自已有的 `ZONE_COLORS` 体系，避免新增色彩语言：

```js
NODE_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple']
```

- 数据：`node.color: string | null`。`null` = 跟随 kind 默认（旧画布完全不变）。
- 渲染：`el.dataset.color = color`，CSS 用 `--nc-*` 变量着色：
  - 标题栏底色（淡）、左侧选中竖条同色、圆点同色、边框淡淡的同色描边。
  - 内容区保持白底 —— 只染「卡片的身份色」，不染正文，避免影响阅读。
- 入口：**节点标题栏的颜色小圆点**（点它弹调色板）。选中节点时也响应 `1`–`7` 键。
- 持久化：`exportCanvasData` / `importCanvasData` / `appendCanvasData` 都带上 `color`；
  缺失或非法 → `null`，与旧行为完全一致。

### 2.3 不影响的东西

- 区域（zone）配色是另一套，不动。
- 执行/连线语义不变：命令仍以 `🖐️` 前缀判定可执行，位置只决定命令挂在哪条线上。
- 大纲/收藏/导入导出结构不新增必填字段。

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `planInsertOnEdge(src,dst,edge,{position})`；`insertNodeOnEdge(edgeId, kind, position)`；`setNodeColor(nodeId, colorKey)` |
| 数据 | 可选字段 `node.color: string\|null` |
| 日志 | `DBG.log('插入节点', id, '位置', position)` / `DBG.log('节点配色', id, color)` |
| 兜底 | 非法 color → 回退 null（按 kind）；非法 position → `before`；旧 JSON 无 color → null |

## 4. 影响面

- `js/edgeops.js`：`planInsertOnEdge` 增加 `position`
- `js/edges.js`：`insertNodeOnEdge` 签名扩展、右键菜单两项、标签 `＋` 弹菜单
- `js/nodes.js`：`color` 字段、标题栏颜色按钮、`setNodeColor`
- `js/shortcuts.js`：`Shift+Insert`、数字键 1–7
- `js/io2.js`：导入导出带 `color`
- `styles.css`：`[data-color]` 配色
- **不改**：区域配色、执行链路、JSON 版本号（新增字段向后兼容）

## 5. 刻意不做

- 任意取色器（color picker）：固定 7 色足够，且能保持整体视觉一致。
- 卡片背景整块着色：会干扰正文阅读，只染标题栏与标记。
- 按颜色筛选/分组：等有真实需求再说。

---

## 6. 实现与校验结果

### 6.1 落地清单

| 文件 | 改动 |
|---|---|
| `js/edgeops.js` | `planInsertOnEdge` 增加 `position`（默认 `before`），返回 `position` 字段；两种位置下命令只出现一次 |
| `js/edges.js` | `insertNodeOnEdge(edgeId, kind, position)`；右键菜单两项（含副标题说明）；标签 `＋` 改为弹菜单而非直接插 |
| `js/nodestyles.js`（新增） | `NODE_COLORS` / `normalizeColor` / `hasCustomColor` / `nextColor` 纯逻辑 |
| `js/nodes.js` | `color` 字段、标题栏色点按钮、`openColorPalette`、`setNodeColor` |
| `js/shortcuts.js` | `Shift+Insert`（命令后）、数字键 `1–7` 上色、`0` 恢复默认 |
| `js/io2.js` | 导出/导入/追加导入都带 `color`（默认色时不写字段） |
| `styles.css` | 7 组 `[data-color]` 预计算变量（不用 `color-mix`）、色点按钮、`#colorPalette`、菜单两行式 |
| `build.js` | `nodestyles.js` 加入 ORDER |

### 6.2 校验结果

- 纯逻辑单测：**98 通过 / 0 失败**（新增 edgeops 8 项 + nodestyles 9 项）
- 构建通过，产物中 `color-mix` 出现 **0** 次（兼容性确认）
- DOM 接线实测（最小 stub 跑真实模块）：
  ```
  before  n4->n6(空)  |  n6->n5(总结)
  after   n7->n9(总结) |  n9->n8(空)

  设置 blue -> data-color 属性 = blue
  非法 pink -> null（回退默认）
  清除 -> data-color 属性 = (已移除)
  导出 color = purple；默认色时导出不含 color 字段：true
  ```
- `tests/e2e_node_color.cjs`：已写（约 20 项），**因本机缺 Playwright 浏览器未执行**，
  有浏览器环境执行 `node build.js && node tests/e2e_node_color.cjs`

### 6.3 过程中的坑

1. **`color-mix()` 兼容性**：旧 WebView 不支持时整条 CSS 声明失效 → 改为预计算 4 个变量。
2. **`dataset.color = ''` 会留下空属性**：`[data-color]` 选择器仍命中 → 统一 `setAttribute`/`removeAttribute`。

### 6.4 使用方式

| 操作 | 路径 |
|---|---|
| 命令前插入 | 右键连线 →「在命令前插入节点」 / `Insert` / 标签 `＋` |
| 命令后插入 | 右键连线 →「在命令后插入节点」 / `Shift+Insert` / 标签 `＋` |
| 设置卡片颜色 | 点标题栏左侧色点 → 选色；或选中后按 `1`–`7`；`0` 恢复默认 |

### 6.5 已知限制

- 颜色是固定 7 色，无自定义取色器（保持整体视觉一致）。
- 只染标题栏/圆点/边框/选中条，正文区保持白底。
- 颜色不参与大纲分组与筛选。
