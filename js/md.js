// =========================================================================
// md.js —— 轻量 Markdown 渲染器（零依赖，单文件离线可用）
//
//   renderMarkdown(src) -> 已转义的安全 HTML 字符串
//
// 安全模型：先把代码块抽成令牌 → 全文 HTML 转义 → 再解析语法 → 还原令牌。
// 任何用户文本都不会以未转义形式进入 innerHTML。
// =========================================================================

const MAX_LEN = 100000;            // 超长输入截断，防渲染卡死
const TOKEN_START = '\u0000CB';    // 代码块占位令牌（输入已剥离 \u0000）
const TOKEN_END = '\u0000';

// HTML 转义
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 链接协议白名单：http/https/mailto/相对路径（不含协议即为相对）
function safeUrl(url) {
  const u = String(url).trim();
  if (!u) return null;
  // 拒绝所有带协议的地址，除非在白名单内
  const m = u.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return null;
  }
  // 拒绝空白与引号，防止属性逃逸
  if (/[\s"'<>`]/.test(u)) return null;
  return u;
}

// 行内解析：粗体 / 斜体 / 行内码 / 链接。输入已是转义后的文本。
function inline(text) {
  // 行内代码优先：内容不再参与其它语法解析
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0001C${codes.length - 1}\u0001`;
  });

  // 链接：[text](url) —— text 内允许粗体等，url 走白名单
  out = out.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (whole, label, url) => {
    const safe = safeUrl(url);
    if (!safe) return label;                       // 不安全 → 降级为纯文本
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // 粗体：**x** 或 __x__
  out = out.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^\n]+?)__/g, '<strong>$1</strong>');
  // 斜体：*x* —— 避开已被消费的 ** 
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  // 还原行内代码
  out = out.replace(/\u0001C(\d+)\u0001/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

// 块级解析：输入为「已抽取代码块、已转义」的多行文本
function blocks(lines) {
  const html = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    html.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    buf.length = 0;
  };

  const para = [];
  while (i < lines.length) {
    const line = lines[i];

    // 代码块令牌（整行独占）
    const tok = line.match(/^\u0000CB(\d+)\u0000$/);
    if (tok) {
      flushParagraph(para);
      html.push(CODE_BLOCKS[Number(tok[1])]);
      i++;
      continue;
    }

    // 空行 → 段落结束
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    // 分割线
    if (/^(?:---|\*\*\*|___)\s*$/.test(line.trim())) {
      flushParagraph(para);
      html.push('<hr>');
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const lv = h[1].length;
      html.push(`<h${lv}>${inline(h[2].trim())}</h${lv}>`);
      i++;
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*+]\s+/, '')));
        i++;
      }
      html.push('<ul>' + items.map(t => `<li>${t}</li>`).join('') + '</ul>');
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*\d+\.\s+/, '')));
        i++;
      }
      html.push('<ol>' + items.map(t => `<li>${t}</li>`).join('') + '</ol>');
      continue;
    }

    // 引用（连续多行合并）。注意：此时文本已转义，'>' 已变成 '&gt;'
    if (/^\s*(?:&gt;|>)\s?/.test(line)) {
      flushParagraph(para);
      const quote = [];
      while (i < lines.length && /^\s*(?:&gt;|>)\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*(?:&gt;|>)\s?/, ''));
        i++;
      }
      html.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>');
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);
  return html.join('\n');
}

// 代码块令牌池（每次渲染重置）
let CODE_BLOCKS = [];

export function renderMarkdown(src) {
  try {
    if (typeof src !== 'string' || !src) return '';
    // 规范化：去 BOM、剥离 \u0000（令牌字符不得来自用户）、截断
    let text = src.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

    // 1) 抽出代码块（``` 或 ~~~），内容先转义，避免被当作语法
    CODE_BLOCKS = [];
    const withoutCode = text.replace(
      /^(?:```|~~~)([^\n`]*)\n([\s\S]*?)^(?:```|~~~)\s*$/gm,
      (_, lang, body) => {
        const language = String(lang).trim().replace(/[^a-zA-Z0-9_+-]/g, '');
        const cls = language ? ` class="lang-${language}"` : '';
        CODE_BLOCKS.push(`<pre><code${cls}>${esc(body.replace(/\n$/, ''))}</code></pre>`);
        return `\n${TOKEN_START}${CODE_BLOCKS.length - 1}${TOKEN_END}\n`;
      },
    );

    // 2) 全文转义，之后一切解析都在安全文本上进行
    const safe = esc(withoutCode);

    // 3) 块级 → 行内
    const lines = safe.split('\n');
    return blocks(lines);
  } catch (e) {
    // 兜底：渲染失败则降级为纯文本（仍然转义）
    try { return `<p>${esc(String(src ?? ''))}</p>`; } catch { return ''; }
  }
}
