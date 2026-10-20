# 节点拖入区域后自动归属（zone-auto-assign）

## 1. 问题

当前节点与区域的关系只能通过节点标题栏的**下拉手动指定**：

```js
// js/nodes.js — 唯一设置入口
pick.addEventListener('change', () => {
  node.zoneId = pick.value || null;
});
```

把卡片拖进区域框里**不会自动归属**。后果：

- 拖完还要逐个点下拉，节点一多非常繁琐；
- 容易漏——节点视觉上在区域内，实际 `zoneId` 是 `null`，大纲归到「未分类」，区域过滤时被淡出；
- 区域拖动会连带移动区域内节点（按 `zoneId` 筛选），漏归属的节点会被落下。

## 2. 设计

### 2.1 判定时机

**节点拖动结束（`pointerup`）时**判定一次，而不是 `pointermove` 每帧判定——避免拖动过程中归属反复跳变导致大纲频繁刷新。

区域拖动（`zone-bar` 拖动）**不触发**重新判定：它连带移动的节点本来就属于该区域，重复判定是多余的，且可能因为坐标浮点误差把它们判到相邻区域。

### 2.2 判定规则：中心点 + 面积最小优先

```
zoneAtPoint(wx, wy):
  候选 = 所有满足 rx <= wx <= rx+rw 且 ry <= wy <= ry+rh 的区域
  若候选为空 → null
  否则返回面积最小的那个（更贴合、更"内层"）
```

- **用节点中心点**而非整体包含：卡片比区域大时也应能归属（视觉上"压在区域里"即为归属）。
- **面积最小优先**：与 `js/geom.js` 的 `hitTest` 策略一致（嵌套时取更贴合的那个），避免大区域"吞掉"小区域里的节点。

### 2.3 归属应用

```js
autoAssignZone(node):
  hit = zoneAtPoint(node.x + node.w/2, node.y + node.h/2)
  next = hit ? hit.id : null
  if (next === node.zoneId) return node.zoneId        // 无变化，跳过
  node.zoneId = next
  refreshZonePicker(node)                             // 同步下拉显示
  refreshOutline()                                    // 同步大纲
  scheduleSnapshot()
```

- 拖出所有区域 → `zoneId = null`（回到「未分类」）。
- 归属变化才写日志与快照，避免每次拖动都触发 autosave。

### 2.4 与手动下拉的关系

**保留手动下拉**，但语义明确为「手动覆盖」：

- 下一次拖动节点会按位置重新判定，可能覆盖手动选择；
- 这是刻意的：位置是更直观的意图表达。文档与 UI 提示都写清楚。

### 2.5 已知边界

| 场景 | 行为 |
|---|---|
| 节点中心在区域外，但有一角伸进来 | 不归属（按中心点） |
| 多个区域重叠且中心都在内 | 归面积最小的 |
| 节点比区域大，中心在区域内 | 归属（合理） |
| 区域被删除 | 已有逻辑清空 `zoneId`（`removeZone`） |
| 导入画布 | `importCanvasData` 直接写入 `zoneId`，不走自动判定（保持原样） |

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `zoneAtPoint(wx, wy) -> zone \| null`；`autoAssignZone(node) -> zoneId \| null` |
| 数据模型 | `node.zoneId: string \| null` 语义不变；导出格式不变（字段已存在） |
| 日志 | `DBG.log('自动归属', nodeId, oldZone, '->', newZone)`；无变化时不打日志 |
| 兜底 | 无命中即清空；重叠取面积最小；区域不存在时 `state.zones[id]` 为空 → 视为未归属 |

## 4. 影响面

- `js/zones.js`：新增 `zoneAtPoint`
- `js/nodes.js`：`startDrag` 的 `onUp` 调用 `autoAssignZone`；新增导出函数
- 间接影响：`outline.js`（大纲分组）、`outline.js applyFilter`（区域过滤）、`chat.js`（画布快照里的归属）
- **不改**：导出/导入格式、区域拖动行为、节点增删

## 5. 校验

### 5.1 单测（`tests/test_zone.mjs`）

1. 点在某区域内 → 返回该区域
2. 点在所有区域外 → `null`
3. 边界上（正好等于 `x` / `x+w`）→ 命中
4. 两个区域重叠 → 返回**面积小**的
5. 三个区域嵌套 → 返回最内层
6. 空区域列表 → `null`

### 5.2 端到端（`tests/e2e_zone_auto.cjs`）

1. 建区域 + 节点，把节点拖到区域内 → `zoneId` 变为该区域
2. 拖出区域 → `zoneId` 变回 `null`
3. 拖动区域内其它节点不受影响
4. 归属变化后大纲（`refreshOutline`）分组更新
5. 无变化时 `zoneId` 保持、不产生多余快照
6. 区域拖动连带节点移动后，节点归属**不变**（不触发重新判定）

### 5.3 回归

既有 7 个套件全部通过。

## 6. 实现与校验结果

### 6.1 改动

| 文件 | 关键改动 |
|---|---|
| `js/geom.js` | 新增 `zoneAtPointIn(wx, wy, zones)` —— 纯几何判定，返回面积最小的命中区域 |
| `js/zones.js` | `zoneAtPoint(wx, wy)` 适配 `state.zones`；`autoAssignZone(node)` 落实归属并同步下拉/大纲/快照 |
| `js/nodes.js` | `startDrag` 的 `onMove` 实时高亮 `drop-target`，`onUp` 调 `autoAssignZone`；`bar` 的 `pointerdown` 用 `closest('.close,.zone-pick,.md-toggle')` 统一排除控件 |
| `styles.css` | `.zone.drop-target` 高亮样式；`.node .bar > * { flex: none }` + `.title` 弹性 + `cursor: grab` |
| `tests/test_zone.mjs` 🆕 | 12 个几何判定单测 |
| `tests/e2e_zone_auto.cjs` 🆕 | 32 项端到端断言（含真实鼠标拖动） |

### 6.2 校验结果（实测）

```
$ node --test tests/test_zone.mjs        → pass 12, fail 0
$ node tests/e2e_zone_auto.cjs
[1] 页面加载            ✔ 无 JS 异常
[2] 纯几何判定          ✔ 区域内命中  ✔ 区域外 null  ✔ 边界命中
[3] 拖入区域            ✔ zoneId 变更  ✔ autoAssignZone 返回值  ✔ 下拉同步
[4] 拖出区域            ✔ 清空  ✔ 返回 null  ✔ 下拉回「未分类」
[5] 重叠区域            ✔ 归小区域  ✔ 仅大区域处归大区域
[6] 无变化              ✔ 归属保持  ✔ 不重复打日志
[7] 手动下拉            ✔ 仍可覆盖
[8] 区域拖动            ✔ 归属不变  ✔ 不触发自动归属
[9] 大纲                ✔ 出现区域标题
[10] 导出               ✔ 含 zoneId、version=1
[11] 真实鼠标拖动       ✔ 节点移动  ✔ 中心入区  ✔ 自动归属  ✔ 抓手存在  ✔ 中心不落在控件上
[11b] 拖动高亮          ✔ 进入高亮  ✔ 拖出取消
[12] 点控件不误拖       ✔ 下拉/关闭  ✔ 预览按钮
[13] 无异常             ✔ 全程无 JS 异常
结果：32 通过，0 失败
```

全量回归（197 项）：

```
tests/test_geom.mjs         → 12 passed
tests/test_zone.mjs         → 12 passed
tests/test_md.mjs           → 21 passed
tests/e2e_node_scroll.cjs   → 21 通过
tests/e2e_md_render.cjs     → 45 通过
tests/e2e_touch_link.cjs    → 17 通过
tests/e2e_port_clash.cjs    → 16 通过
tests/e2e_ux_fixes.cjs      → 21 通过
tests/e2e_zone_auto.cjs     → 32 通过
```

### 6.3 过程中的坑

1. **标题栏控件吃掉拖动起手点**：`bar` 的 `pointerdown` 只排除了 `.close` 与 `.zone-pick`，漏了 `.md-toggle`；且 `.zone-pick` 没有 `flex: none`，会抢 `.title` 的弹性空间。窄节点（180px）下标题栏中心正好落在下拉上，**点中心根本不触发拖动**——这是「模拟坐标能过、真实拖拽失败」的根因。
2. **纯几何判定必须放在无 DOM 依赖的模块**：`zoneAtPointIn` 一开始写在 `zones.js`，但 `zones.js` 顶层 `import ./edges.js`（依赖 `document`），`node --test` 直接报 `document is not defined`。改放 `geom.js`。
3. **`pointermove` 不能做重活**：每帧写 `zoneId`、刷新大纲、触发 autosave 会卡顿。拆成「移动时只切 class，松手时落实归属」。

### 6.4 遗留与注意

- **手动下拉会被下一次拖动覆盖**——这是刻意的（位置是更直观的意图表达）。若将来需要「锁定归属」，应给 `node` 加 `zoneLocked` 字段。
- 判定用**节点中心点**：卡片比区域大时仍能归属（合理）；但只有一角伸进区域时不归属。
- 导入画布时 `importCanvasData` 直接写入 `zoneId`，**不走**自动判定，保持原样。
