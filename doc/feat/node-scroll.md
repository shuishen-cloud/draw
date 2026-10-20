# 修复卡片内滚动栏（node-scroll）

## 1. 问题（实测）

在 390×844 手机视口下，往 `doc` 节点塞 200 行文本后测得：

| 指标 | 实测值 | 期望值 |
|---|---|---|
| `.node` 高度 | **52.7px** | 160px（创建时的 `h`） |
| `.body` 高度 | 41.5px | ≈ 137px（节点高 − 标题栏） |
| `.body` overflow | `visible` | `hidden` |
| `textarea` 高度 | 41.5px | ≈ 137px |
| `textarea.scrollHeight` | **4358px** | 4344px |
| 能否滚动 | **否**（无独立滚动容器） | 能 |

**现象**：卡片被压成一条，内容溢出到节点外、盖住其它节点；滚动栏（scrollbar）要么不出现，要么拖动时整个画布跟着动。

## 2. 根因

1. `.node` 是 `display:flex; flex-direction:column`，`.body` 只有 `flex: 1`，**缺 `min-height: 0`**。flex 子项的默认 `min-height: auto` 会阻止其收缩到内容以下 —— 但这里更严重的是反向失效：`.body` 的 `min-height:0` 已在 reset 里被写成 `0px`，可 `.body` 内部**没有滚动容器**，内容直接把 body 撑破并溢出（`overflow: visible`），同时 `.node` 的 `height` 被 flex 的最小内容高度反推压缩。
2. `textarea` 写的是 `flex: 1`，在纵向 flex 容器里等价于 `flex: 1 1 0%`，**但没有 `height: 0` 作为 flex 基线**，Safari/移动端 WebKit 会按内容尺寸参与计算，导致无法收缩到可视高度。
3. `.out` / `.exec-out` 有 `overflow-y: auto` 但同样缺 `min-height: 0`，父级不收缩时它们也不会滚。
4. 手机上滚到底会**继续带动画布缩放**（`#canvas` 的 `touch-action: none` 与滚动手势冲突），需要 `overscroll-behavior: contain`。

## 3. 设计

统一「滚动容器」规范，三层各司其职：

```
.node               固定 height（来自 node.h），flex column，overflow: visible（端口要露出来）
 └ .bar             flex: none
 └ .body            flex: 1 1 auto; min-height: 0; overflow: hidden   ← 关键：成为约束边界
    └ textarea/.out flex: 1 1 0; height: 0; min-height: 0; overflow-y: auto
```

- **`.node`** 保持 `overflow: visible`（端口/手柄要伸出边框，不能被裁掉）。
- **`.body`** 成为滚动约束边界：`min-height: 0` + `overflow: hidden`。它不自己滚，只负责"让子项有确定高度可分配"。
- **内容区**（`textarea` / `.out` / `.exec-out`）真正滚动：`height: 0` 提供 flex 基线，`flex: 1 1 auto` 填满，`min-height: 0` 允许收缩，`overflow-y: auto` 出滚动条。
- **exec 节点**：`prompt` 区是固定高度（不伸缩），结果区 `flex:1` 滚动。
- **移动端**：所有滚动区加 `overscroll-behavior: contain`，滚到底不穿透到画布。
- **滚动条可见性**：细滚动条（`scrollbar-width: thin`），但保证能看见，不回退到 `none`。

## 4. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | 无新增；行为变化：节点内内容区可独立滚动 |
| 数据模型 | 无变化（不动 `node.h`，不改导入导出格式） |
| 日志 | 无新增 |
| 兜底 | 节点缩到最小 80px 时内容区仍可滚（`min-height` 由 `height:0` 保证）；若浏览器不支持 `overscroll-behavior` 则忽略，不影响滚动本身 |

## 5. 影响面

- `styles.css`：`.node .body` / `.node textarea` / `.node .out` / `.node .exec-prompt` / `.node .exec-out`
- 不改：JS 逻辑、数据结构、导入导出
- 风险：`textarea` 加 `height:0` 后若某处依赖其自然高度（如自动撑高），会失效 —— 当前代码无自动撑高逻辑，安全

## 6. 校验

### 6.1 自动化（端到端）

`tests/e2e_node_scroll.cjs`：手机视口下创建 4 种节点，各塞超量内容，断言：

1. 节点高度 == `node.h`（不被内容压缩/撑大）
2. `.body` 高度 == 节点高 − 标题栏高（±2px）
3. 内容区 `scrollHeight > clientHeight` 且 `overflow-y == auto`
4. `.body` 的 `overflow == hidden`（不溢出）
5. 设置 `scrollTop` 后能读到非 0 值（真的能滚）
6. 内容溢出节点外时，节点 `getBoundingClientRect` 高度不变

### 6.2 手工

- 手机上单指在节点内上下滑 → 只滚内容，画布不动
- 滑到内容底部继续滑 → 画布不缩放/不平移
- 图片节点不出现多余滚动条

## 7. 实现与校验结果

（close 阶段回填）
