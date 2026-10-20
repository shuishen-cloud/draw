# 移动端友好连线（touch-link）

## 1. 问题

1. **手机上没法起连**：只���节点右侧 14~18px 的小圆点能拖出连线，手指落点粗，几乎点不中。
2. **连线方向被端口限制**：`startLinkFrom` 硬编码从 `x + w, y + h/2`（右中）出发，`edgeGeometry` 也固定用"源节点右中 → 目标节点左中"。但所有节点在语义上都能当输入或输出（文档/图片/输出/执行都可被读、也可产出），限制左右方向没有意义。
3. **必须精确落到端口上**：`findNodeAt` 走的是 `getBoundingClientRect`，虽然已支持落在节点矩形内，但节点内 `textarea` 等子元素会抢事件，且没有容差、没有视觉反馈。
4. **连线动画坏了**：`redrawEdges()` 每次都 `svg.innerHTML = ''` 重建全部 path，`stroke-dashoffset` 动画在重建瞬间归零、且只有 `.running` 的线才有动画，执行结束后立即重绘导致动画"抖一下就没"。同时 `flashEdge` 用 `setTimeout(redrawEdges, 600)` 直接抹掉状态。

## 2. 设计

### 2.1 任意节点可双向连

- 每个节点保留左右两个圆点作为**视觉提示**，但不再独占交互：节点的**整个边框**（含 10px 容差带）都可作为连线起点，也可作为落点。
- 起连手势：在节点上 `pointerdown` 后**拖出**（位移 > 8px 屏幕像素）即开始连线；未拖出则视为普通点击/选中/拖动节点。
  - 拖动节点仍从标题栏（`.bar`）发起，与起连不冲突。
- 建边后不区分方向语义：`Edge.source/target` 仅表示"谁的内容流向谁"，与几何位置解耦。

### 2.2 落在边上即成边

- `hitNodeBand(cx, cy, tol)`：把屏幕坐标转成 world 坐标，判断点是否落在节点矩形**外扩 tol 的边界带**内（`tol = 12 / view.scale`，即屏幕上约 12px）。
- 命中规则优先级：**边界带命中 > 矩形内部命中 > 空白**。落在矩形内部（比如文字上）同样接受，因为用户意图明确。
- 拖动中：实时更新预览线（ghost），并把命中的候选节点加 `.link-target` 高亮；松手时按同一规则判定。
- 落在自身、落在空白 → 取消，清理 ghost 与高亮。

### 2.3 连线几何：连在边上

- `edgeGeometry(edge)`：取两个节点矩形，计算**各自朝向对方的边界锚点**（`rectAnchor`）：
  - 若水平方向间隔大于垂直方向间隔，锚点取左右边中点；
  - 否则取上下边中点。
- 结果：线始终从"边上"出发、落到"边上"，不再因为节点重叠或反向而穿模。

### 2.4 动画修复

- 动画只由 class 驱动，不做内联 `stroke-dashoffset` 计算：
  - `.wire.running` —— 执行中，橙色虚线沿路径流动；
  - `.wire.executable` —— 可执行（命令以 🖐️ 开头），静态强调色；
  - `.ghost` —— 拖动预览，虚线流动表明"还在拖"。
- `redrawEdges()` 改用**增量更新**：已存在的边复用 DOM（只更新 `d` 与 class），不再整层重建。新边追加、消失的边移除。这样动画状态在拖动/重绘时不被打断。
- `flashEdge` 改为加 class（`.flash-skip` / `.flash-ok`）并在 `animationend` 后移除，不再 `setTimeout` 全量重绘。

## 3. API / 数据模型 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `startLinkFrom(node, e) -> void`；`edgeGeometry(edge) -> {x1,y1,x2,y2} \| null`；`rectAnchor(from, to) -> {x,y}`；`hitNodeBand(wx, wy, tol) -> node \| null` |
| 数据模型 | `linkState.pending = {source, x1,y1, x2,y2, targetId\|null}`；`Edge` 结构不变（`id/source/target/command`），**导出格式 version 不变**，旧画布兼容 |
| 日志 | `DBG.log('起连', nodeId, '锚点', x, y)`；`DBG.log('候选目标', id)`；`DBG.log('建边', src, '->', dst)`；取消时 `DBG.log('连线取消：<原因>')` |
| 兜底 | `pointercancel` 与窗口 `blur` 一律取消拖拽并清理 ghost/高亮；命中自身忽略；坐标换算统一走 `screenToWorld`，缩放/平移下不偏移 |

## 4. 影响面

- `js/edges.js`：连线核心（起连、几何、渲染、动画类）
- `js/nodes.js`：节点整体参与起连/落点，端口降级为视觉提示
- `styles.css`：`.port` 热区、`.link-target` 高亮、`.wire.running` / `.ghost` 动画、`.flash-*`
- 不改：导入导出格式、执行逻辑（`exec.js` 仅换 flash 实现）、任务/区域

## 5. 校验

无前端测试框架，采用「静态检查 + 浏览器手测清单」：

- **静态**：`node --check` 全量 `js/*.js` 通过；`node build.js` 能产出单文件。
- **手测**：
  1. 手机（或 DevTools 触摸模拟）：手指按住节点**任意边框**向外拖，出现预览线；松在另一节点边框上 → 建边成功。
  2. 落在目标节点**边线上**（不要求圆点）→ 建边成功。
  3. 落点距离边框 <12px（屏幕）→ 建边成功。
  4. 落在空白 → 取消，无残留 ghost / 高亮。
  5. 反向连（右侧节点指向左侧节点）→ 线从左边出发、落到右边，不穿模。
  6. 执行一条 `🖐️` 命令的连线 → 流动动画持续到流式结束，结束时不抖。
  7. 拖动节点 → 线跟随，动画不中断。
  8. 旧画布（本地 localStorage）载入正常。

## 6. 实现与校验结果

（close 阶段回填）
