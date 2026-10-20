/**
 * 极简本地服务（零依赖）
 *   GET  /                     -> 返回 index.html
 *   POST /proxy  { url }       -> 抓取网页，返回 { url, title, text }
 *
 * 用途：解决浏览器直接 fetch 外部网页的 CORS 限制。
 * 启动：node server.js   （默认 http://localhost:8090）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;

// ---------- 工具：抓取网页并抽取正文文本 ----------
async function fetchPage(rawUrl) {
  const target = new URL(rawUrl);
  if (!/^https?:$/.test(target.protocol)) throw new Error('只支持 http/https 链接');

  const res = await fetch(target.href, {
    redirect: 'follow',
    headers: {
      // 伪装成浏览器，减少被拒
      'User-Agent': 'Mozilla/5.0 (compatible; MutipleChatDemo/1.0)',
      'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`目标返回 HTTP ${res.status}`);

  const ctype = res.headers.get('content-type') || '';
  const body = await res.text();

  // 纯文本直接返回
  if (!ctype.includes('html')) {
    return { url: target.href, title: target.hostname, text: body.slice(0, 200000) };
  }

  const { title, text } = extractText(body);
  return { url: target.href, title, text };
}

// 极简正文抽取：去掉 script/style/nav 等，取可读文本
function extractText(html) {
  let s = html;
  // 标题
  const mTitle = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = mTitle ? decodeEntities(mTitle[1]).trim() : '';

  // 移除噪声标签
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
       .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<header[\s\S]*?<\/header>/gi, ' ')
       .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
       .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
       .replace(/<!--[\s\S]*?-->/g, ' ');

  // 块级标签转换行
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
       .replace(/<br\s*\/?>/gi, '\n');

  // 去所有标签
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s);
  // 压缩空白
  s = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return { title, text: s.slice(0, 200000) };
}

function decodeEntities(s) {
  const map = {
    amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', apos: "'",
    laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    hellip: '…', mdash: '—', ndash: '–', middot: '·', times: '×', copy: '©',
    trade: '™', deg: '°', euro: '\u20ac', pound: '£', yen: '¥', sect: '§',
  };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, e) => map[e] ?? m);
}

// ---------- 路由 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// 本地开发服务器：明确禁止缓存。
// 没有这几个头时浏览器会走「启发式缓存」，改完 js/css 普通刷新拿到的仍是旧文件，
// 必须强制刷新才能看到改动，容易误判成功能没生效。
// Pragma / Expires 给只认 HTTP/1.0 头的老代理兜底。
const NO_CACHE = {
  'Cache-Control': 'no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  // ---- /proxy ----
  if (u.pathname === '/proxy') {
    let target = u.searchParams.get('url');
    if (!target && req.method === 'POST') {
      const chunk = await readBody(req);
      try { target = JSON.parse(chunk).url; } catch { /* ignore */ }
    }
    if (!target) {
      res.writeHead(400, { ...cors, ...NO_CACHE, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '缺少 url 参数' }));
    }
    try {
      const data = await fetchPage(target);
      res.writeHead(200, { ...cors, ...NO_CACHE, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      console.log(`[proxy] ${target} -> ${data.text.length} 字`);
    } catch (e) {
      res.writeHead(502, { ...cors, ...NO_CACHE, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e.message || e) }));
      console.log(`[proxy] 失败 ${target}: ${e.message}`);
    }
    return;
  }

  // ---- 静态文件 ----
  let filePath = u.pathname === '/' ? '/index.html' : u.pathname;
  filePath = path.join(ROOT, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // 404 也禁缓存，否则修好文件后仍会看到旧的错误
      res.writeHead(404, { ...NO_CACHE, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...NO_CACHE,
    });
    res.end(buf);
  });
});

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(d));
  });
}

server.listen(PORT, () => {
  console.log(`✅ 服务已启动: http://localhost:${PORT}`);
  console.log(`   抓取接口: http://localhost:${PORT}/proxy?url=<要抓的网址>`);
});
