# 执行节点结果不可见 + 开发态 ▶ 按钮 ReferenceError（exec-run-visible）

## 1. 问题

两个 bug 一起暴露，都发生在「执行节点（exec）」上。

### 1.1 执行节点「看起来不执行」

用户点执行节点的 ▶（或双击标题），界面完全静止，没有任何结果。

实际链路：

| 环节 | 行为 |
|---|---|
| `js/nodes.js:261` | 非 `img` 节点创建后**默认进入预览态**（`setNodeMode(node,'preview')`）。此时 `.body` 被 `hidden`，用户看到的是 `.md-view` |
| `js/exec.js:80-88` | 预览区内容**只在 `setOutput()` 里**刷新（其中含 `dataset.mode === 'preview'` 分支） |
| `js/run.js` 旧 `runExecNode` | **绕过 `setOutput`**，直接 `node.textEl.textContent = t`，写进隐藏的 `.body` |

于是流式输出全部落在不可见 DOM 上，可见的 `.md-view` 停留在创建时的快照
（只有提示词）。必须手动点「编辑」再点「预览」才能看到结果。

连进行中的「思考中…」也写进隐藏区，因此界面**完全静止**，强化了「没执行」的错觉。

### 1.2 开发态 `ReferenceError: runNodeById is not defined`

```
Uncaught ReferenceError: runNodeById is not defined
    at HTMLButtonElement.<anonymous> (nodes.js:247:7)
```

`js/nodes.js` 顶部只导入了 `runExecNode`，但文件里真正调用的是 `runNodeById`：

```js
import { runExecNode } from './run.js';   // ← 死导入
...
runNodeById(node.id);                     // ← 从未导入
```

**为什么长期没被发现**：所有 e2e 测试都跑 `MutipleChat.html`（`build.js` 把各模块
拼接进同一作用域，符号天然共享，缺失的 import 被彻底掩盖）。只有用
`node server.js` 起开发态 `index.html`（原生 ES module，模块作用域隔离）才会炸。

## 2. 设计

### 2.1 结果可见：让 exec 走与 output 相同的渲染路径

不要在 `runExecNode` 里重复实现预览刷新，而是**统一走 `setOutput`**。
它是唯一持有「预览态实时刷新」逻辑的地方：

```js
if (node.el?.dataset.mode === 'preview') {
  const v = node.el.querySelector('.md-view');
  if (v) v.innerHTML = renderMarkdown(src) || '<p class="md-empty">（无内容）</p>';
}
```

`runExecNode` 改为：

- 初始态 `setOutput(node, '思考中…')` —— 进行中提示也可见；
- `onDelta` 里 `setOutput(node, t)` + 节流重绘（结果增长会改变节点尺寸，连线要跟上）；
- 补 `.running` class 做运行脉冲（与 `runEdge` 一致）；
- `try/catch/finally` 兜底：`streamLLM` 若抛异常，回写 `❌ 原因`，绝不卡在「思考中…」。

### 2.2 预览内容语义：exec 只展示结果

原逻辑把 `text + prompt` 拼接：

```js
const src = [node.text || '', node.prompt || ''].filter(Boolean).join('\n\n');
```

对 exec 节点不合适——用户想看的是**结果**。若不改，修好可见性后首屏会显示提示词，
结果被挤到下面，仍然像「没生成」。

故 `setOutput` 与 `setNodeMode` 两处都按 `kind` 分支：

| 节点类型 | 预览内容 |
|---|---|
| `exec` | 仅 `text`（结果）；提示词在编辑态可见 |
| `doc` / `output` | `text` + `prompt` 拼接（保持原行为） |

### 2.3 修复死导入

`nodes.js` 的 `import { runExecNode }` 在全文件**没有任何调用**，改为
`import { runNodeById }`。

### 2.4 防复发：补齐测试盲区

`tests/e2e_tablet_run.cjs` 原断言只检查 `n.text`（内部状态），**不查界面可见性**——
正是这个盲区让 1.1 漏网。新增两条：

- 结果必须在预览区可见（`mode==='preview'` 时 `.md-view` 含结果）；
- 运行后不得停留在「思考中…」。

`tests/e2e_md_render.cjs` 原断言「exec 节点渲染提示词 h2」与新语义冲突，
改为断言预览**不**展示提示词。

## 3. 接口

```js
runExecNode(nodeId: string) -> Promise<void>
setOutput(node, text: string) -> void
```

## 4. 日志

- `runExecNode <id> 入边数 = N`
- `聚合输入长度 = N | 图片数 = M`
- `runExecNode <id> 完成，输出 N 字`
- 异常路径：`DBG.err('执行节点异常', nodeId, err)`

## 5. 兜底

| 场景 | 行为 |
|---|---|
| `streamLLM` 抛异常 | `catch` 回写 `❌ <message>` |
| 无提示词 | `alert` 提示并 return（原有） |
| 无入边 | `alert` 提示并 return（原有） |
| 无 API Key | `alert` 提示并 return（原有） |
| `finally` | 移除 `.running`、重绘连线，任何路径都不留残影 |

## 6. 影响

- 仅影响执行节点与 Markdown 预览渲染路径；
- `output` / `doc` 节点行为不变；
- 开发态（`index.html`）与构建产物（`MutipleChat.html`）行为一致化；
- **已部署的 `MutipleChat.html` 需重新构建并覆盖**。

## 7. 实现与校验结果

（收尾阶段回填）
