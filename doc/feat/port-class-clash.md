# 端口 class 撞名导致的水平滚动条与整页溢出（port-class-clash）

## 1. 现象

在 8090 实际服务上用无头浏览器测量到：

| 现象 | 实测 |
|---|---|
| 整页出现水平滚动条 | `documentElement.scrollWidth = 756` vs `clientWidth = 430` |
| 端口元素尺寸异常 | `.port.out` 的 `offsetWidth = 298`（应为 18） |
| 端口带 `overflow-x: auto` | 本身成为滚动容器 |
| 节点内水平溢出 | `.node` `scrollWidth 310` > `clientWidth 298` |
| 预览区显示异常拥挤 | 与上述溢出叠加 |

## 2. 根因（两个，互相独立）

### 2.1 类名撞车：`out` 既是端口后缀，又是内容区类名

端口 DOM：

```html
<div class="port out" title="拖出连线"></div>
```

项目里内容区样式：

```css
.node .out { flex: 1 1 0; width: 100%; min-width: 0; min-height: 0; }
```

`.node .out` 特异性 **0,2,0**，`.port` 只有 **0,1,0**。于是：

- `width: 100%` 覆盖 `.port` 的 `width: 18px` → 端口被撑成整个节点内容宽度（298px）
- `min-width: 0` + 绝对定位 + 撑满宽度 → 产生横向溢出，浏览器给端口加上滚动语义

**实测证据**（逐个 class 试）：

| class | offsetWidth |
|---|---|
| `port out` | **298** |
| `port` | 18 |
| `out` | **298** |
| `""` | **298**（`position: static`，完全不匹配任何规则） |

### 2.2 折叠侧栏仍占布局宽度，`#stage` 不裁剪

移动端折叠规则：

```css
#outline.collapsed, #sidebar.collapsed { flex-basis: min(78vw, 320px); width: ...; }
#outline.collapsed { transform: translateX(-102%); }
#sidebar.collapsed { transform: translateX(102%); }
```

`transform` 只改变绘制位置，**不改变布局占位**。两侧栏各 320px + 画布 430px，`#stage.scrollWidth` 远超 `clientWidth`。而 `#stage` 是 `overflow: visible`，溢出继续上传到 `html` → **整页水平滚动条**。

## 3. 设计

1. **端口类名与语义解耦**：`port in` → `port-in`，`port out` → `port-out`。
   - 不叫 `in` / `out` 的原因正是本节要修的撞名问题；加 `port-` 前缀后特异性固定为 `0,2,0`（`.port.port-out`），且不可能与其它模块的通用类名冲突。
2. **`#stage` 承担裁剪职责**：`overflow: hidden`。
   - 侧栏的滑出动画依赖"保留宽度 + transform"，因此**不能**把折叠侧栏的 `flex-basis` 改为 0（会失去过渡动画）。
   - 正确做法是在 `#stage` 这一层裁剪。`#canvasWrap` 已经是 `overflow: hidden`，但 `#stage` 没有，溢出会穿透。

## 4. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | 无新增；CSS 选择器 `.port.in` / `.port.out` 更名为 `.port-in` / `.port-out` |
| 数据模型 | 无变化 |
| 日志 | 无新增 |
| 兜底 | 端口仍绝对定位在边框上（`left/right: -8px`），溢出由 `#stage` 统一裁剪，不影响点击（端口 `z-index: 4` 高于 `#stage` 的裁剪语义，仅视觉裁剪） |

## 5. 影响面

- `js/nodes.js`：端口 DOM class 与两处 `querySelector`
- `styles.css`：`.port.port-in` / `.port.port-out`、`#stage`
- **不改**：连线逻辑、Markdown 渲染、滚动规范、数据结构

## 6. 校验

### 6.1 自动化

新增断言（并入现有 e2e）：

1. 所有 `.port` 的 `offsetWidth/offsetHeight === 18`
2. `documentElement.scrollWidth === documentElement.clientWidth`（无整页水平滚动）
3. `hasHScroll === false`
4. 端口 class 中不含裸 `in` / `out`（防回归）
5. 全部既有测试无回归（geom 12 / md 21 / node-scroll 21 / md-render 45 / touch-link 17）

### 6.2 手工

- 手机上左右滑 → 页面不横移
- 端口圆点大小正常（18px 圆），不是长条
- 侧栏展开/折叠动画正常

## 7. 实现与校验结果

（close 阶段回填）
