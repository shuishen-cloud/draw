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

### 7.1 改动清单

| 文件 | 改动 |
|---|---|
| `js/run.js` | `runExecNode` 改走 `setOutput`；补 `.running` 脉冲、`try/catch/finally`、节流重绘 |
| `js/exec.js` | `setOutput` 对 `exec` 节点预览只渲染结果 |
| `js/nodes.js` | 死导入 `runExecNode` → `runNodeById`；`setNodeMode` 对 `exec` 只渲染结果 |
| `tests/e2e_tablet_run.cjs` | 新增「结果在预览区可见」「不停留在思考中…」两条断言 |
| `tests/e2e_md_render.cjs` | 「exec 渲染提示词 h2」→ 改为「预览不展示提示词」 |
| `tests/e2e_dev_mode.cjs` | **新增**：开发态（`index.html` + 原生 ESM）e2e 冒烟 |

### 7.2 关键判据（复现方式）

```js
// 修复前：结果写进了 hidden 的 .body，可见的 .md-view 仍是旧快照
{ mode: 'preview', bodyHidden: true,
  mdViewHTML: '<p>总结</p>',        // 用户看到的
  textElValue: 'RESULT-TEXT' }      // 实际结果
```

判断「是不是这个 bug」只看一条：**`textEl` 有值但 `.md-view` 没有** →
结果被写进了不可见 DOM。

### 7.3 测试先红后绿

新断言在旧实现下**确实变红**（否则等于没测）：

```
旧实现 + 新断言：
  ✖ 执行结果在预览区可见（默认预览态） mode=preview preview="（无内容）"
  ✖ exec 预览不展示提示词（只展示结果） true
  ✖ exec 预览 h2 数（来自结果本身） 1
  结果：44 通过，3 失败

新实现：全部通过
```

`e2e_dev_mode.cjs` 同样验证过能抓住原 bug（临时回退 `nodes.js` 导入）：

```
  ✖ 请求已发出 calls=0
  ✖ 结果在预览区可见 "（无内容）"
  ✖ Markdown 渲染生效 false
  ✖ 全程无 JS 异常 PAGEERROR: runNodeById is not defined
  结果：6 通过，4 失败
```

### 7.4 全量回归

```
e2e_dev_cache      15 通过，0 失败
 e2e_dev_mode       10 通过，0 失败   ← 新增
e2e_md_render     46 通过，0 失败
e2e_node_scroll   21 通过，0 失败
e2e_port_clash    16 通过，0 失败
e2e_tablet_run    37 通过，0 失败
e2e_touch_link    17 通过，0 失败
e2e_ux_fixes      21 通过，0 失败
e2e_zone_auto     32 通过，0 失败
单测：geom 12 / md 21 / zone 12，全 pass
```

合计 **215 项 e2e 断言 + 45 项单测断言，0 失败**。

### 7.5 ⚠️ 服务器需要更新

本次修改涉及 `js/` 三个模块，**已部署的运行方式不同，更新方式也不同**：

| 部署形态 | 是否需操作 | 做法 |
|---|---|---|
| 单文件 `MutipleChat.html`（平板离线/静态托管） | **必须重新构建并覆盖** | 本地 `node build.js` → 覆盖服务器上的 `MutipleChat.html` |
| 开发态 `node server.js`（`index.html` + `js/*.js`） | **需重启或刷新** | 拉取最新代码后重启 `node server.js`；浏览器强刷一次 |
| Docker 镜像 | **必须重建镜像** | `docker build` 后重新部署容器（`js/` 已 COPY 进镜像） |
| Nginx 静态部署 | **必须重新构建并同步** | `node build.js` 后把产物同步到站点根目录 |

**验证是否已更新**：打开页面 → 建一个执行节点 → 填提示词 → 连一条上游 → 点 ▶。
若结果直接出现在卡片里（此前必须手动点「编辑」再点「预览」才看得到），说明已生效。

另外，开发态此前会抛 `ReferenceError: runNodeById is not defined`，点 ▶ 完全没反应；
更新后该报错应消失。

### 7.6 教训

`build.js` 把所有模块拼进同一作用域，**会掩盖缺失的 ES import**。
任何「只有开发态才炸」的问题都无法被跑 `MutipleChat.html` 的测试发现。
故补 `tests/e2e_dev_mode.cjs`，让开发态也有冒烟覆盖。

