# 连线操作与工具栏重做（edge-ops）

## 1. 现状问题

| # | 问题 | 现状 | 影响 |
|---|---|---|---|
| 1 | **工具栏视觉沉重** | 上一版做成 316px 宽的竖向面板，每组两列大按钮（图标+文字），占 1/4 屏高 | 「工具」应该轻，现在比画布内容还抢眼；和悬浮球挤在同一角 |
| 2 | **删除连线没有可见入口** | 只能先点选中、再按 `Delete`；且 `run.js` 与 `shortcuts.js` **各绑了一次**键盘监听 | 触摸设备完全删不掉线；键盘路径重复触发 |
| 3 | **连线中间不能插入节点** | 想「A → 总结 → B」必须：新建节点 → 删线 → 连两次 | 三步变一步是这类画布工具的核心手感 |

## 2. 设计

### 2.1 工具栏重做（问题 1）

目标：**看起来是工具条，不是控制台**。

- 宽度 316 → **264px**，头部压缩到 34px，去掉「拖我移动」这句说明文字（拖动本身可发现）。
- 分组改成**图标按钮 + 12px 文字**的紧凑网格（3 列），按钮高 30px：
  - 组标题用小号灰字（`新建` / `导入` / `画布` / `运行`），比留白分隔线更省空间。
- 主操作「运行」独占一行，通栏实心。
- 悬浮球与面板错开：球在左下角，面板在其**上方**（`bottom: 74px`），开面板时球仍在原位可点（收起入口不再被盖）。
- 分组内图标按钮 `aria-label` + `title` 双保险，文字缩短不牺牲可发现性。

### 2.2 删除连线（问题 2）

三条入口，覆盖鼠标 / 触摸 / 键盘：

1. **选中 + `Delete`**：保留，但**只保留一处**监听（收敛到 `shortcuts.js`，删掉 `run.js` 里重复的那段）。
2. **右键连线**：`contextmenu` 弹出小菜单「插入节点 / 删除连线」（宽 150px，贴鼠标位置，点外部/Esc 关闭）。
3. **连线标签上的 `×`**：选中态时，标签右侧出现一个 14px 的 `×`（触摸设备主要靠它）。

> 删除走 `removeEdgeSilent`：先移除标签 DOM、清理 `selectedEdgeId`，**不直接重绘**，
> 由调用方统一 `redrawEdges()`，避免在批量操作里重绘多次。

### 2.3 连线中间插入节点（问题 3）

`insertNodeOnEdge(edgeId, kind = 'doc')`：

```
原:  A ──(cmd)──> B
后:  A ──(cmd)──> X ──(空)──> B
```

规则：

- 新节点位置 = 两节点中心的中点，尺寸取默认值，再向四周推开到中点（`x = midX - w/2`）。
- **命令归属**：原命令留在 **A → X**（上游命令描述的是「对 A 的输出做什么」，语义上属于产生 X 的那一段）；
  X → B 命令为空。这样 `Alt+Enter` 从 A 出发仍然执行原来的命令。
- 区域归属：新节点与 A 同区域（`zoneId = A.zoneId`），避免插完掉到大纲外面。
- 原连线删除、两条新连线建立，`selectedNodeId` 指向新节点，**不移动视口**。
- 失败兜底：任一节点不存在 → 不动原连线，`flashToast('插入失败：连线已失效')`。

**入口**：
- 右键连线 → 「插入节点」
- 选中连线后标签上的 `+` 按钮
- 键盘 `Insert`（选中连线时）

新节点默认 `kind='doc'`、标题「节点」，创建后**自动进入标题编辑态**，少一次双击。

### 2.4 键盘收敛

`run.js` 里那段 `Alt+Enter` / `Delete` 顶层监听删除，全部并入 `shortcuts.js`：
- `Alt+Enter` → `runCurrentEdge()`
- `Delete/Backspace` → 先删选中的节点，否则删选中的连线（已有逻辑）
- `Insert` → 在选中连线上插入节点

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `insertNodeOnEdge(edgeId, kind) -> node \| null`；`removeEdgeSilent(edgeId) -> void` |
| 数据 | 不新增字段；插入即 `removeEdge + addEdge×2` |
| 日志 | `DBG.log('插入节点', nodeId, '← 连线', edgeId)` / `DBG.log('删除连线', id)` |
| 兜底 | 端点不存在 → 保留原连线并提示；菜单越界 → 夹进视口；触摸设备右键菜单改用按钮入口 |

## 4. 影响面

- `index.html`：工具栏结构（分组标题 + 网格）
- `styles.css`：工具栏尺寸/网格/悬浮球位置；连线标签的 `+` / `×`；右键菜单样式
- `js/edges.js`：`insertNodeOnEdge`、`removeEdgeSilent`、右键菜单、标签按钮
- `js/shortcuts.js`：新增 `Insert`、`Alt+Enter`；删除 `run.js` 的重复绑定
- `js/run.js`：移除顶层 keydown
- **不改**：执行链路语义、画布 JSON 结构、收藏/导入导出

## 5. 刻意不做

- 连线「拖到中途松手即插入」的拖拽手势（需区分「连线到节点」与「插到线上」，容易误触，先用菜单/按钮）。
- 多选批量删除（依赖尚未实现的多选）。
- 自动重排布局（插入后位置固定在中点，不做避让）。

---

## 6. 实现与校验结果

### 6.1 落地清单

| 文件 | 改动 |
|---|---|
| `js/edgeops.js`（新增） | `planInsertOnEdge(src,dst,edge,opts)` 纯逻辑：中点坐标、命令归属上游、区域继承、`valid` 判定；`canRemoveEdge` |
| `js/edges.js` | `insertNodeOnEdge` / `removeEdgeSilent` / `#edgeMenu` 右键菜单（挂 body，规避 `#canvasWrap` 裁剪）/ 标签上的 `＋插入` `×删除` |
| `js/nodes.js` | 顶层注入 `HOST.createNode/removeEdge/selectNode`，让依赖保持单向 |
| `js/shortcuts.js` | 新增 `Alt+Enter`（运行）、`Insert`（插入节点）；修正修饰键判断顺序 |
| `js/run.js` | 删除顶层重复的 `Alt+Enter` / `Delete` 监听 |
| `index.html` | 工具栏重排为「新建 / 导入 / 画布 / 运行」四段，去掉「拖我移动」 |
| `styles.css` | 工具栏 264px、头部 34px、3 列紧凑网格（按钮 30px）；悬浮球与面板错开（`bottom:74px`）；`#edgeMenu`；标签小按钮 |
| `build.js` | `edgeops.js` 加入 ORDER（edges.js 之前） |
| `tests/test_edgeops.mjs`（新增） | 11 项纯逻辑单测 |

### 6.2 校验结果

- `node --test tests/test_edgeops.mjs`：**11 通过 / 0 失败**
- 全量纯逻辑单测（edgeops + geom + zone + md + chattool）：**81 通过 / 0 失败**
- `node build.js`：构建通过，模块缺失检查通过
- 接线实测（最小 DOM stub 跑真实模块）：
  ```
  初始: 2 节点, 1 连线
  插入后连线: n1->n3(总结) , n3->n2(空)
  原连线已删: true
  removeEdgeSilent: true  对不存在 id: false
  ```
- `tests/e2e_edge_ops.cjs`：已写（34 项），**因本机 Playwright 浏览器二进制缺失未执行**，
  需在有浏览器的环境补跑：`node build.js && node tests/e2e_edge_ops.cjs`

### 6.3 过程中的两个坑

1. **edges ↔ nodes 双向依赖**：直接 `import { createNode } from './nodes.js'` 能跑（函数提升），
   但单文件构建按 ORDER 拼接 + 将来顶层副作用会出问题。改为 `nodes.js` 顶层挂 `HOST`，`edges.js` 经 `HOST` 调用。
2. **`Alt+Enter` 被吞**：`if (mod || e.altKey) return;` 写在 `Alt+Enter` 判断之前。
   规律：含修饰键的快捷键必须在「通用放行」之前判断。

### 6.4 使用方式

| 操作 | 路径 |
|---|---|
| 删除连线 | 右键连线 → 删除 / 选中后标签上 `×` / 选中按 `Delete` |
| 插入节点 | 右键连线 → 在中间插入节点 / 选中后标签上 `＋` / 选中按 `Insert` |
| 收起工具栏 | 点 `×` 或悬浮球；悬浮球常驻左下，随时再开 |

### 6.5 已知限制

- 未实现「拖线到连线中间松手即插入」的手势（易与「连到节点」误触），先用菜单/按钮。
- 插入节点固定为 `doc` 类型，创建后自动进入重命名态。
- 浮窗可互相遮挡，拖动或点头部会把它提到最前；不做自动避让。
