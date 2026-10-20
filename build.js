#!/usr/bin/env node
// =========================================================================
// build.js —— 把多模块项目打包成单个离线 HTML（用于平板/手机本地打开）
//
//   用法：node build.js
//   输出：MutipleChat.html（单文件，内联 CSS + 全部 JS，双击即可运行）
//
// 原理：ES Module 在 file:// 协议下会被 CORS 拦截，无法直接 import。
//       故把 CSS 内联 <style>，把各模块去掉 import/export 后按依赖顺序
//       拼接进同一个 <script>，模块间通过同一作用域共享符号。
//       因原项目是「运行时循环依赖」（函数体内互相调用），合并后完全等价。
// =========================================================================
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// 依赖顺序：被依赖的在前。循环依赖间顺序不敏感（函数声明提升）。
const ORDER = [
  'state.js',
  'md.js',
  'geom.js',
  'viewport.js',
  'minimap.js',
  'zones.js',
  'outline.js',
  'nodes.js',
  'edges.js',
  'exec.js',
  'run.js',
  'tasks.js',
  'chat.js',
  'io1.js',
  'io2.js',
  'main.js',
];

// 去掉 import 语句 与 export 关键字
function stripModule(code) {
  return code
    // 删除 import { ... } from '...';  （含跨行）
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
    // export function / export async function / export const ...
    .replace(/^(\s*)export\s+(async\s+function|function|const|let|var|class)/gm, '$1$2')
    // 删除纯 export { a, b }; 语句（如有）
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
}

function build() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  // 拼接 JS
  const parts = [];
  const missing = [];
  for (const name of ORDER) {
    const p = path.join(ROOT, 'js', name);
    if (!fs.existsSync(p)) { missing.push(name); continue; }
    const code = stripModule(fs.readFileSync(p, 'utf8'));
    parts.push(`// ===== ${name} ${'='.repeat(60 - name.length)}\n${code.trim()}\n`);
  }
  if (missing.length) {
    console.error('❌ 缺少模块:', missing.join(', '));
    process.exit(1);
  }

  // 检查 JS 里是否还有残留的 import/export（防止 strip 遗漏）
  const js = parts.join('\n');
  const leftover = js.split('\n')
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => /^\s*(import|export)\b/.test(l));
  if (leftover.length) {
    console.error('❌ 仍有未处理的 import/export:');
    leftover.slice(0, 10).forEach(({ l, i }) => console.error(`   行${i}: ${l.trim()}`));
    process.exit(1);
  }

  // 内联进 HTML：替换 <link rel=stylesheet> 和 <script type=module src=...>
  let out = html;
  out = out.replace(/<link[^>]*styles\.css[^>]*>/i, `<style>\n${css}\n</style>`);
  out = out.replace(
    /<script[^>]*src=["'][^"']*main\.js["'][^>]*><\/script>/i,
    `<script>\n${js}\n</script>`
  );

  // 标记为离线单文件（在 </title> 后加注释便于识别）
  out = out.replace('</head>', '<!-- 单文件离线版，由 build.js 生成 -->\n</head>');

  const outPath = path.join(ROOT, 'MutipleChat.html');
  fs.writeFileSync(outPath, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log(`✅ 已生成 ${path.basename(outPath)}  (${kb} KB)`);
  console.log('   把这个文件传到平板，用浏览器直接打开即可。');

  // 校验：CSS 和 JS 是否真的内联成功
  if (!/<style>/.test(out)) console.error('⚠️  CSS 未内联，请检查 index.html 里的 <link>');
  if (/<script[^>]*src=/.test(out)) console.error('⚠️  JS 未内联，请检查 index.html 里的 <script src>');
}

build();
