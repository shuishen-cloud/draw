# 修复：标题栏颜色/收藏按钮重叠（titlebar-buttons）

## 1. 现象（用户反馈）

1. **颜色设置和收藏的位置重叠了**
2. **有的节点没有颜色选项**

## 2. 根因

两个按钮的 CSS 完全重合：

```css
.node .bar .fav-node { position: absolute; left: 4px; top: 50%; /* … */ z-index: 2; }
.node .node-color    { position: absolute; left: 4px; top: 50%; /* … */ z-index: 3; }
```

- 同一个 `left: 4px; top: 50%` → **物理上完全重叠**；
- 两者都写 `opacity: 0`，只在 `:hover` 时变 1 → **平时都不可见**；
  鼠标悬停时两枚按钮同时显现，视觉上像「一个奇怪的按钮」，点下去常常命中收藏；
- 触摸设备**没有 hover** → 永远点不到颜色（表现为「这个节点没有颜色选项」）。

## 3. 修复

| 项 | 修复 |
|---|---|
| 布局 | 两个按钮从 `absolute` 改为**文档流内的 flex 项**，各占 15×15，永不重叠 |
| 可见性 | 默认 `opacity: 1`，不再依赖 hover（触摸可用） |
| 颜色按钮外观 | 实心圆 = 已上色；空心圈 = 跟随类型默认色 |
| 收藏按钮 | 改用 `.ic ic-star`（不再用 `⭐` 字符，避免 Emoji 字体缺失时的豆腐块） |
| `.dot` | 与颜色按钮语义重复 → 隐藏，把宽度让给标题 |
| 一个连带 bug | `pointerdown` 的排除列表缺 `.node-color`，点颜色会**连带拖动节点** |

## 4. 静态契约（tests/test_ui_assets.mjs 新增 4 项）

- 标题栏按钮**不得**使用 `position: absolute`
- 必须有非零宽高
- 必须默认可见（`opacity: 1`，不能等 hover）
- `pointerdown` 排除列表必须包含 `.node-color`

## 5. 影响面

- `styles.css`：标题栏按钮布局
- `js/nodes.js`：收藏图标、`pointerdown` 排除列表
- `tests/test_ui_assets.mjs`
- **不改**：数据结构、配色逻辑、调色板行为

## 6. 校验

- `node --test tests/*.mjs`：**110 通过 / 0 失败**

### 人工验证

1. 悬停/选中任意节点 → 标题栏左侧出现**两个并排**小按钮：色圈 + 星。
2. 点色圈 → 弹调色板，选色后色圈变实心、卡片标题栏变色。
3. 点星 → 收藏，不弹调色板、**节点也不会被拖动**。
4. 触摸设备（或 DevTools 触摸模拟）不悬停也能看到并点到这两个按钮。
