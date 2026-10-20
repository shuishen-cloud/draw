// =========================================================================
// test_md.mjs —— md-render 的单元测试（node --test）
//
//   运行：node --test tests/test_md.mjs
//   覆盖：块级/行内语法、代码块隔离、链接协议白名单、XSS 转义、边界输入
// =========================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../js/md.js';

// 所有输出都不应包含可执行标签
function assertNoInjection(html) {
  assert.ok(!/<script/i.test(html), '不得出现 <script>: ' + html);
  assert.ok(!/<iframe/i.test(html), '不得出现 <iframe>: ' + html);
  assert.ok(!/\son\w+\s*=/i.test(html), '不得出现内联事件处理器: ' + html);
  assert.ok(!/javascript:/i.test(html), '不得出现 javascript: 协议: ' + html);
}

test('空输入与非字符串', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
  assert.equal(renderMarkdown(123), '');
  assert.equal(renderMarkdown({}), '');
});

test('标题 1~6 级', () => {
  assert.match(renderMarkdown('# 一级'), /<h1>一级<\/h1>/);
  assert.match(renderMarkdown('## 二级'), /<h2>二级<\/h2>/);
  assert.match(renderMarkdown('### 三级'), /<h3>三级<\/h3>/);
  assert.match(renderMarkdown('###### 六级'), /<h6>六级<\/h6>/);
});

test('粗体与斜体', () => {
  assert.match(renderMarkdown('**粗**'), /<strong>粗<\/strong>/);
  assert.match(renderMarkdown('__粗__'), /<strong>粗<\/strong>/);
  assert.match(renderMarkdown('*斜*'), /<em>斜<\/em>/);
  assert.match(renderMarkdown('_斜_'), /<em>斜<\/em>/);
  assert.match(renderMarkdown('**粗** 和 *斜*'), /<strong>粗<\/strong>.*<em>斜<\/em>/);
});

test('行内代码', () => {
  const html = renderMarkdown('用 `const x = 1` 声明');
  assert.match(html, /<code>const x = 1<\/code>/);
});

test('代码块：语言标注 + 内部 Markdown 不被解析', () => {
  const html = renderMarkdown('```js\nconst a = **not bold**;\n```');
  assert.match(html, /<pre><code class="lang-js">/);
  assert.ok(!/<strong>/.test(html), '代码块内的 ** 不应变成 <strong>: ' + html);
  assert.match(html, /not bold/);
});

test('代码块：内部 HTML 被转义', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.ok(!/<script/i.test(html), html);
  assert.match(html, /&lt;script&gt;/);
});

test('无序列表', () => {
  const html = renderMarkdown('- 甲\n- 乙\n- 丙');
  assert.match(html, /<ul>/);
  assert.match(html, /<li>甲<\/li>/);
  assert.match(html, /<li>丙<\/li>/);
});

test('有序列表', () => {
  const html = renderMarkdown('1. 一\n2. 二');
  assert.match(html, /<ol>/);
  assert.match(html, /<li>一<\/li>/);
});

test('列表项内的粗体（嵌套行内）', () => {
  const html = renderMarkdown('- **重点** 内容');
  assert.match(html, /<li><strong>重点<\/strong> 内容<\/li>/);
});

test('引用', () => {
  const html = renderMarkdown('> 引用一句话');
  assert.match(html, /<blockquote>/);
  assert.match(html, /引用一句话/);
});

test('分割线', () => {
  assert.match(renderMarkdown('---'), /<hr\s*\/?>/);
  assert.match(renderMarkdown('***'), /<hr\s*\/?>/);
});

test('链接：正常地址输出 <a>，带安全属性', () => {
  const html = renderMarkdown('[示例](https://example.com)');
  assert.match(html, /<a [^>]*href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, />示例<\/a>/);
});

test('链接：http / mailto / 相对路径允许', () => {
  assert.match(renderMarkdown('[a](http://x.com)'), /<a /);
  assert.match(renderMarkdown('[a](mailto:x@y.com)'), /<a /);
  assert.match(renderMarkdown('[a](./doc.md)'), /<a /);
});

test('XSS：<script> 被转义', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assertNoInjection(html);
  assert.match(html, /&lt;script&gt;/);
});

test('XSS：img onerror 被转义', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assertNoInjection(html);
});

test('XSS：javascript: 链接降级为非链接', () => {
  const html = renderMarkdown('[点我](javascript:alert(1))');
  assertNoInjection(html);
  assert.ok(!/<a /i.test(html), '不应生成 <a>: ' + html);
});

test('XSS：data: 链接降级为非链接', () => {
  const html = renderMarkdown('[点我](data:text/html,<script>alert(1)</script>)');
  assertNoInjection(html);
  assert.ok(!/<a /i.test(html), '不应生成 <a>: ' + html);
});

test('XSS：属性注入（引号闭合）', () => {
  const html = renderMarkdown('[x](https://a.com" onmouseover="alert(1))');
  assertNoInjection(html);
});

test('换行与段落', () => {
  const html = renderMarkdown('第一行\n第二行');
  assert.match(html, /<br\s*\/?>/);
  const p = renderMarkdown('段落一\n\n段落二');
  assert.match(p, /<p>段落一<\/p>/);
  assert.match(p, /<p>段落二<\/p>/);
});

test('超长输入被截断而不抛错', () => {
  const long = 'x'.repeat(300000);
  const html = renderMarkdown(long);
  assert.ok(html.length < 300000, '应被截断，实际 ' + html.length);
});

test('混合文档综合渲染', () => {
  const src = [
    '# 标题',
    '',
    '一段 **粗体** 与 `code`。',
    '',
    '- 甲',
    '- 乙',
    '',
    '> 引用',
    '',
    '```python',
    'print(1)',
    '```',
  ].join('\n');
  const html = renderMarkdown(src);
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /lang-python/);
  assertNoInjection(html);
});
