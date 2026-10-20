# Markdown 渲染（md-render）

## 1. 问题

- 节点内容（`doc` / `output` / `exec`）与对话气泡全部走 `textContent`，用户写的 Markdown 只能看到源码。
- LLM 输出天然是 Markdown（标题、列表、代码块），当前直接显示成一堆 `##`、`-`、` ```
`，可读性差。
- 长文没有排版层级，难以快速扫读。

## 2. 关键约束

1. **编辑必须保留源码** —— `textarea` 不能替换为富文本编辑器，否则光标/输入法/撤销全部要重写。
2. **零依赖** —— 项目是 `build.js` 内联所有 JS 的单文件离线应用（`MutipleChat.html` 双击即用，`file://` 协议）。引入 `marked` / `markdown-it` 会：
   - 增加约 30–40KB 体积；
   - 需要在 `build.js` 增加第三方 vendor 处理；
   - 破坏"零依赖、单文件、离线"的定位。
3. **必须防 XSS** —— 内容来源包括 LLM 输出、导入的任意文本文件、剪贴板。绝不能把用户文本直接拼进 `innerHTML`。

## 3. 设计

### 3.1 双模式：编辑 / 预览

每个节点加一个「预览」切换（在标题栏），两种模式共用同一块 `.body` 区域：

| 模式 | 显示 | 数据源 |
|---|---|---|
| 编辑（默认） | `textarea` / `.out` 纯文本 | 不变，可正常输入 |
| 预览 | `.md-view` 渲染后 HTML | `node.text` / `node.prompt` |

- 切换状态只存在 DOM（`node.el.dataset.mode = 'edit' \| 'preview`），**不写入导出 JSON**，`version` 保持 1，旧画布完全兼容。
- 预览时点击内容区任意位置 → 切回编辑（符合"点一下就改"的直觉）。
- 图片节点无文本内容，不显示切换按钮。

### 3.2 渲染器：`js/md.js`

纯函数 `renderMarkdown(src) -> string`（已转义的安全 HTML）。

**处理顺序（关键）**：

```
1. 输入规范化（非字符串 → ''，超过 100k 截断）
2. 提取代码块 → 占位令牌（避免代码里的 * _ # 被当作语法）
3. 全文 HTML 转义（& < > " '）
4. 逐行块级解析（标题 / 列表 / 引用 / 分割线 / 段落）
5. 段落内行内解析（粗体 / 斜体 / 行内码 / 链接）
6. 还原代码块令牌（内容已转义）
```

**为什么先提取代码块**：若先转义再解析，``` 代码块里的 `**` 会被误判为粗体；若先解析再转义，HTML 标签会被转义成文本。用令牌两步走可同时保证正确性与安全性。

**支持的语法**（够用即可，不求完整 CommonMark）：

| 语法 | 输出 |
|---|---|
| `# ` ~ `###### ` | `<h1>`~`<h6>` |
| `**粗**` / `__粗__` | `<strong>` |
| `*斜*` / `_斜_` | `<em>` |
| `` `码` `` | `<code>` |
| ` ```lang ` … ` ``` ` | `<pre><code class="lang-xx">` |
| `- ` / `* ` / `1. ` | `<ul>/<ol><li>` |
| `> ` | `<blockquote>` |
| `---` | `<hr>` |
| `[text](url)` | `<a href rel="noopener noreferrer" target="_blank">` |
| 单换行 | `<br>`（保留用户换行意图） |
| 空行 | 段落分隔 |

**链接安全**：只允许 `http:` / `https:` / `mailto:` / 相对路径；`javascript:` / `data:` 等一律降级为纯文本。

### 3.3 接入点

| 位置 | 改动 |
|---|---|
| `doc` / `output` / `exec` 节点 | 标题栏加「预览/编辑」按钮；`.body` 内新增 `.md-view` 层 |
| 对话气泡（`chat.js addMsg`） | 助手回复走 `renderMarkdown`，用户消息保持纯文本（避免用户输入的 Markdown 被误解为指令） |
| `build.js` | `ORDER` 中把 `md.js` 放在 `state.js` 之后（无依赖，只需在 `nodes.js` / `chat.js` 之前） |

### 3.4 样式

`.md-view` 复用 `.body` 的滚动规范（`flex:1 1 0; min-height:0; overflow-y:auto`），内部元素补排版：

- 标题：`h1`~`h3` 递减字号 + 上间距
- 列表：`padding-left: 1.4em`，`li` 行高与正文一致
- 代码块：浅灰底、圆角、横向滚动（`overflow-x: auto`，不撑宽节点）
- 行内码：浅灰底 + 等宽字体
- 引用：左侧竖线 + 淡色文字
- 链接：强调色 + `text-decoration: underline`

## 4. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | `renderMarkdown(src: string) -> string` |
| 数据模型 | **无新增持久化字段**；预览状态仅存 DOM |
| 日志 | `DBG.log('切换预览', nodeId, mode)`；`DBG.log('Markdown 渲染', srcLen, '->', htmlLen)` |
| 兜底 | 渲染器任何异常 → 降级为 `escapeHtml(src)` 纯文本；非字符串 → `''`；超长截断 100k；链接协议白名单 |

## 5. 影响面

- 新增 `js/md.js`
- `js/nodes.js`：节点标题栏 + 预览切换
- `js/chat.js`：气泡渲染
- `styles.css`：`.md-view` 排版
- `build.js`：模块顺序
- **不改**：导出/导入格式、执行逻辑、连线、区域

## 6. 校验

### 6.1 单测（`tests/test_md.mjs`）

1. 标题 1–6 级
2. 粗体 / 斜体 / 行内码
3. 无序列表 / 有序列表
4. 代码块（含语言标注、内部 `**` 不被解析）
5. 引用 / 分割线
6. 链接（正常 URL 输出 `<a>`）
7. **XSS**：`<script>alert(1)</script>` 必须转义
8. **XSS**：`<img src=x onerror=alert(1)>` 必须转义
9. **XSS**：`[x](javascript:alert(1))` 必须降级为非链接
10. 非字符串输入 → `''`
11. 超长输入截断
12. 嵌套：列表项内的粗体

### 6.2 端到端（`tests/e2e_md_render.cjs`）

1. 创建 `doc` 节点，输入 Markdown，点「预览」→ 出现 `<h2>` / `<ul>` / `<strong>`
2. 预览时点击 → 切回编辑，`textarea` 值未被修改
3. 内容区仍可滚动（沿用 node-scroll 的规范）
4. 对话气泡渲染 Markdown
5. 预览态下渲染结果中不含真实 `<script>` 元素

## 7. 实现与校验结果

（close 阶段回填）
