# 修复：点击颜色不切换（color-fix）

## 1. 现象

点节点标题栏的颜色按钮 → 调色板能弹出 → **点色块后卡片颜色不变**。

## 2. 根因（两条，叠加导致）

### 2.1 配色 CSS 静默丢失

`styles.css` 里「卡片配色」整块样式**完全没有写入**。

原因：当时用 Python 按字符串锚点做批量替换，锚点 `/* 节点标题栏：更柔和的底色 */` 在文件里
已不存在（前一次改动已把该行改掉），`str.replace` 找不到就**静默什么都不做**，退出码仍是 0。

后果：
- `.node[data-color] .bar` 等着色规则缺失 → 设了 `data-color` 也看不出任何变化；
- 更致命的是 `.node .node-color` **没有任何尺寸规则** → 按钮 `width/height` 为 auto、
  内容为空 → 实际渲染成 0×0，**用户根本点不到**（hover 看不到、点击无响应）。

### 2.2 调色板「点内部也会被关掉」

```js
document.addEventListener('pointerdown', (e) => {   // ← 捕获阶段
  if (!pop.hidden && !pop.contains(e.target) && ...) pop.hidden = true;
}, true);
```

事件顺序是 `pointerdown(捕获)` → … → `click`。点色块时：
1. 捕获阶段先跑，`pop.contains(e.target)` 为 true，**这条本身没问题**；
2. 但按钮在 `.node` 内，节点上有 `pointerdown` 的拖拽/选中逻辑，且色点按钮的
   `pointerdown` 只做了 `stopPropagation` —— 与捕获监听配合不稳定；
3. 一旦面板先被 `hidden`，随后的 `click` 目标已不在渲染树里，`closest('button')` 返回 `null`，
   于是「既不关也不上色」。

## 3. 修复

| # | 修复 |
|---|---|
| 1 | 补回 `styles.css` 的 7 组 `[data-color]` 变量、标题栏/圆点/选中条着色、色点按钮的**显式 14×14 尺寸** |
| 2 | 外部关闭从「捕获阶段 pointerdown」改为「冒泡阶段 click」，并显式排除 `pop.contains(target)` 与 `.node-color` |
| 3 | 新增 `tests/test_ui_assets.mjs`：对 `styles.css` / `nodes.js` 做**静态契约断言**，把「必须存在什么」写进测试 |

## 4. 为什么加静态测试

这类「样式没写进去」的问题，运行时 e2e 很难覆盖（需要恰好点到那个 0×0 的按钮）。
静态断言成本低、跑得快（无需浏览器），能直接挡住「改了但没生效」：

- 7 种颜色都有 `--nc` 变量
- 色点按钮必须有非零宽高
- 不得使用 `color-mix()`（旧 WebView 会静默丢弃整条声明）
- 调色板必须用 `click` 委托，且**不得**在捕获阶段 `pointerdown` 里关闭

## 5. 影响面

- `styles.css`：补回配色块
- `js/nodes.js`：调色板外部关闭时机
- `tests/test_ui_assets.mjs`（新增）
- **不改**：数据结构、导出格式、`setNodeColor` 签名

## 6. 校验

- `node --test tests/*.mjs`：**106 通过 / 0 失败**（含新增 8 项静态断言）
- 产物检查：7 组配色变量、色点 14px、调色板样式均在 `MutipleChat.html` 中

---

## 7. 落地与校验

- 已补回 `styles.css` 配色块（7 组变量 + 标题栏/圆点/选中条 + 色点按钮 14×14）。
- 调色板外部关闭改为冒泡 `click`，并排除面板内点击与 `.node-color`。
- `node --test tests/*.mjs`：**106 通过 / 0 失败**。
- 产物契约：7 色变量、色点尺寸、调色板样式均在 `MutipleChat.html` 中。

### 复现与验证步骤（人工）

1. hover 节点 → 标题栏左侧出现小色圈（未上色时是空心圈）。
2. 点它 → 弹出 7 色 + 「跟随类型默认」。
3. 点任一色块 → **标题栏底色/圆点/边框立即变色**，面板自动关闭。
4. 再点色点 → 当前色有黑框高亮；点「跟随类型默认」→ 恢复。
