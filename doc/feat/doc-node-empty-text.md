# 新建文档节点不再预填默认文字（doc-node-empty-text）

## 1. 问题

工具栏「＋ 文档节点」新建出来的卡片里，内容区恒有一句

> 在这里输入要处理的文档…

用户每次都要先全选删掉才能写自己的内容，非常打断输入。

## 2. 根因

`js/main.js` 的 addDoc 回调把提示语当成**正文**传进去了：

```js
document.getElementById('addDoc').addEventListener('click', () =>
  createNode('doc', { x: 120, y: 120, text: '在这里输入要处理的文档…' }));
```

而 `js/nodes.js` 的文档节点 textarea 本来就有占位符：

```js
ta.placeholder = '在这里输入文档内容…';
```

于是同一个提示出现了两次：一次是真实内容（要手删），一次是 placeholder（自动消失）。
`createNode` 已经用 `text: opts.text ?? ''` 兜底，所以只要不传 `text` 就是空节点。

## 3. 方案

去掉 addDoc 里的 `text` 参数即可。**不动 `createNode` 的签名**，
因为 `io1.js`（导入文件、从 URL 抓取）、`io2.js`（导入画布）、示例画布、
多画布恢复都依赖「显式传入则使用传入值」。

```js
document.getElementById('addDoc').addEventListener('click', () =>
  createNode('doc', { x: 120, y: 120 }));
```

## 4. 影响面

| 场景 | 是否受影响 |
|---|---|
| 工具栏「＋ 文档节点」 | ✅ 改为空内容（本次目标） |
| 「📂 导入文件」/「🔗 从链接导入」 | ❌ 显式传 `text`，不变 |
| 「⬆ 导入」画布 JSON / 多画布切换 | ❌ 走 `importCanvasData`，不变 |
| 首屏示例画布 | ❌ 显式传 `text`，不变 |

## 5. 测试

`tests/e2e_add_doc_empty.cjs`（Playwright，跑构建产物）：

1. 点「＋ 文档节点」→ `state.nodes[新id].text === ''`
2. 对应 textarea 的 `value === ''`
3. textarea 的 `placeholder` 仍然存在（提示不丢，只是变成占位符）
4. 新建后立即输入文字能正常落进 `node.text`（回归：不是只读）
5. 页面内不再出现「在这里输入要处理的文档…」这段当作正文
6. 全程无 JS 异常

## 6. 实现与校验结果

### 6.0 复核（fix 阶段）

- 全量回归确认改动只影响「＋ 文档节点」：`e2e_ux_fixes` 依赖首屏示例（显式传 text），
  仍 21 项全绿；`e2e_multi_canvas` / `e2e_canvases_logic` 的多画布切换不受影响。
- 已确认没有第二处把该提示语写进 `text` 的调用：全仓搜索
  `grep -rn "在这里输入" js/ index.html` 只剩 `nodes.js` 的 placeholder 一处。
- 旧数据不自动清洗的取舍见 6.3。

### 6.1 改动

- `js/main.js`：addDoc 去掉 `text` 参数（1 行）。
- `tests/e2e_add_doc_empty.cjs`：新增，6 组断言。
- `build.js`：无需改（未新增模块）。

### 6.2 结果

```
tests/e2e_add_doc_empty.cjs   通过，0 失败
```

### 6.3 边界

- 旧画布里已经存了这句提示语的节点**不会被自动清洗**：那是用户的数据，
  静默改写风险更大。需要时手动删除即可。
- placeholder 文案仍为「在这里输入文档内容…」，与工具栏提示略有差异，
  本次不统一（避免影响已有 e2e 对文案的断言）。
