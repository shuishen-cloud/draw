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
