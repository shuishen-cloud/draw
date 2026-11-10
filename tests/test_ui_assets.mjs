// =========================================================================
// test_ui_assets.mjs —— 静态检查：UI 关键样式/接线必须在产物里
//
// 背景：卡片配色那次，styles.css 的整块样式因为替换锚点写错而**静默丢失**，
// 按钮尺寸为 0、点了没反应。这类「CSS 没写进去」用运行时测试很难发现，
// 所以加一层产物静态断言，把契约写死在测试里。
//
//   node --test tests/test_ui_assets.mjs   （需先 node build.js）
// =========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const nodesJs = fs.readFileSync(path.join(ROOT, 'js/nodes.js'), 'utf8');

test('卡片配色：7 种颜色都有 CSS 变量定义', () => {
  for (const c of ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple']) {
    const re = new RegExp(`\\.node\\[data-color="${c}"\\]\\s*\\{[^}]*--nc:`);
    assert.match(css, re, `缺少 ${c} 的配色变量`);
  }
});

test('卡片配色：标题栏与圆点使用配色变量', () => {
  assert.match(css, /\.node\[data-color\] \.bar\s*\{[^}]*background:\s*var\(--nc-weak\)/);
  assert.match(css, /\.node\[data-color\] \.dot\s*\{[^}]*background:\s*var\(--nc\)/);
});

test('色点按钮有非零尺寸（否则点不到）', () => {
  const m = css.match(/\.node \.node-color\s*\{([^}]*)\}/);
  assert.ok(m, '缺少 .node .node-color 样式块');
  assert.match(m[1], /width:\s*1[0-9]px/, '色点按钮没有宽度，用户无法点击');
  assert.match(m[1], /height:\s*1[0-9]px/, '色点按钮没有高度');
});

test('调色板容器与色块样式存在', () => {
  assert.match(css, /#colorPalette\s*\{/);
  assert.match(css, /#colorPalette \[hidden\]|#colorPalette\[hidden\]/);
  assert.match(css, /\.cp-swatch\[data-color="blue"\][^}]*background:\s*#2563eb/);
});

test('不使用 color-mix()（旧 WebView 不支持会静默失效）', () => {
  // 只看声明部分：注释里提到函数名不算违规
  const decls = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/color-mix\(/.test(decls), false);
});

test('调色板点击走 click 委托，且能从按钮读回颜色 key', () => {
  assert.match(nodesJs, /pop\.addEventListener\('click'/);
  assert.match(nodesJs, /setNodeColor\(n\.id, b\.dataset\.color \|\| null\)/);
});

test('调色板的外部关闭不会在面板内部点击时提前触发', () => {
  assert.match(nodesJs, /if \(pop\.contains\(e\.target\)\) return;/, '缺少「点面板内不关闭」判断');
  // 不能再用捕获阶段的 pointerdown 关闭：它先于面板的 click 执行，会把点击目标移出文档
  assert.equal(
    /document\.addEventListener\('pointerdown',[\s\S]{0,300}pop\.hidden = true;[\s\S]{0,20}\}, true\)/.test(nodesJs),
    false,
    '外部关闭仍在使用捕获阶段 pointerdown，会导致面板内点击失效',
  );
});

test('「跟随类型默认」项可清除颜色', () => {
  assert.match(nodesJs, /cp-clear[^>]*data-color=""/);
});
