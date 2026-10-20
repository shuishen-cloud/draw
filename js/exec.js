import { API_URL, DBG, PREFIX, state } from './state.js';
import { redrawEdges } from './edges.js';
import { renderMarkdown } from './md.js';
// 9. 执行核心
// =========================================================================
export async function runEdge(edgeId) {
  const edge = state.edges[edgeId];
  if (!edge) { DBG.warn('runEdge: 连线不存在', edgeId); return; }

  DBG.log('========== runEdge', edgeId, '开始 ==========');
  const cmd = edge.command.trim();
  DBG.log('命令 =', JSON.stringify(cmd));
  if (!cmd.startsWith(PREFIX)) {
    DBG.warn('命令未以 ' + PREFIX + ' 开头，跳过');
    flashEdge(edge, 'skip');
    return;
  }
  const promptText = cmd.slice(PREFIX.length).trim();
  DBG.log('promptText =', JSON.stringify(promptText));

  const src = state.nodes[edge.source];
  const dst = state.nodes[edge.target];
  if (!src || !dst) { DBG.err('端点节点不存在'); return; }
  const doc = src.text || '';
  // 源节点如果含图片，把 dataURL 一起带去（视觉模型可识别）
  const images = [];
  if (src.kind === 'img' && src.src) images.push(src.src);
  DBG.log('输入文档长度 =', doc.length, '前50字 =', JSON.stringify(doc.slice(0, 50)),
          '| 图片数 =', images.length);
  // 源节点既无文字也无图片 → 没东西可处理
  if (!doc && images.length === 0) {
    DBG.warn('源节点既无文字也无图片，跳过');
    flashEdge(edge, 'skip');
    return;
  }

  const key = document.getElementById('apiKey').value.trim()
    || localStorage.getItem('deepseek_key') || '';
  if (!key) { alert('请先填写 DeepSeek API Key'); return; }

  setOutput(dst, '');
  dst.textEl.classList.remove('empty');
  edge.running = true;
  redrawEdges();
  // 流式输出期间节流重绘：目标节点内容增长会改变尺寸，线要及时跟上，
  // 但不要每帧重绘（会拖慢渲染）。running 动画靠 class 维持，不受重绘影响。
  let redrawQueued = false;
  const scheduleRedraw = () => {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => { redrawQueued = false; redrawEdges(); });
  };
  const outText = await streamLLM({
    key, promptText, doc, images,
    onDelta: (t) => { setOutput(dst, t); scheduleRedraw(); },
  });
  edge.running = false;
  redrawEdges();
  DBG.log('========== runEdge', edgeId, '结束，输出', outText.length, '字符 ==========');
}

export function setOutput(node, text) {
  node.text = text;
  if (node.kind === 'output') {
    node.textEl.textContent = text;
    node.el.querySelector('.out').classList.toggle('empty', !text);
  } else if (node.kind === 'doc') {
    // 目标是文档节点：直接覆盖文本
    node.textEl.value = text;
  } else if (node.kind === 'exec') {
    // 目标是执行节点：写入其结果区（使得一个执行节点的输出可被下游继续使用）
    if (node.textEl) {
      node.textEl.textContent = text;
      node.textEl.classList.toggle('empty', !text);
    }
  }
  // 图片节点：不支持写入文本，忽略

  // 若该节点正处于 Markdown 预览态，实时跟着刷新（否则流式输出时预览是冻结的）
  if (node.el?.dataset.mode === 'preview') {
    const src = [node.text || '', node.prompt || ''].filter(Boolean).join('\n\n');
    const v = node.el.querySelector('.md-view');
    if (v) v.innerHTML = renderMarkdown(src) || '<p class="md-empty">（无内容）</p>';
  }
}

export function flashEdge(edge, type) {
  // 先设状态再重绘：重绘会按 edge.flash 同步 class，保证绑到当前的 path 元素上
  edge.flash = type === 'skip' ? 'skip' : 'ok';
  redrawEdges();
  if (!edge.pathEl) { edge.flash = null; return; }
  const p = edge.pathEl;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    p.removeEventListener('animationend', finish);
    edge.flash = null;
    redrawEdges();
  };
  p.addEventListener('animationend', finish);
  setTimeout(finish, 1200);   // 兜底：动画未触发（如偏好减少动态效果）也恢复
}

// =========================================================================
// 10. LLM 流式请求
// =========================================================================
// 构造请求体：支持「纯文本」与「文本 + 图片」两种模式
// images: dataURL 数组（如 "data:image/png;base64,..."）
export function buildPayload(promptText, doc, images = []) {
  const systemText =
    '你是文本/图像处理引擎。用户会给你【文档】（可能包含文字和图片），' +
    '你必须严格按照【命令】处理它。\n' +
    '若输入包含图片，请直接识别图片内容后按命令处理（不要说你无法看到图片）。\n' +
    '只输出处理结果本身，不要复述命令，不要添加解释、前言或后记。\n\n' +
    '【命令】：' + (promptText || '处理下面的内容');

  // 有图片 → 用多模态 content 数组；否则用普通字符串（保持向后兼容）
  let userContent;
  if (images.length) {
    userContent = [
      { type: 'text', text: '【文档】开始\n' + (doc || '（无文字，只有图片）') + '\n【文档】结束\n\n请执行【命令】，只输出结果。' },
      ...images.map(url => ({ type: 'image_url', image_url: { url } })),
    ];
  } else {
    userContent = '【文档】开始\n' + (doc || '') + '\n【文档】结束\n\n请执行【命令】，只输出结果。';
  }

  return {
    model: 'deepseek-chat',   // 注：当前会路由到 deepseek-flash（支持图片）
    stream: true,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userContent },
    ],
  };
}

export async function streamLLM({ key, promptText, doc, images = [], onDelta }) {
  DBG.lastRequest = buildPayload(promptText, doc, images);
  // 图片 dataURL 很长，调试打印时用摘要代替，避免刷屏
  const summary = JSON.parse(JSON.stringify(DBG.lastRequest, (k, v) =>
    (k === 'url' && typeof v === 'string' && v.startsWith('data:'))
      ? `[dataURL ${Math.round(v.length / 1024)}KB]` : v));
  DBG.log('发起请求 ->', API_URL, '\n请求体(摘要) =', summary);

  let full = '';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(DBG.lastRequest),
    });
    if (!res.ok) {
      const errText = await res.text();
      DBG.err('HTTP 失败', res.status, errText);
      onDelta('❌ HTTP ' + res.status + ' ' + errText);
      return '';
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', chunkCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) chunkCount++;
          full += delta;
          onDelta(full);
        } catch (e) { DBG.warn('SSE 解析失败:', s, e.message); }
      }
    }
    DBG.log('流结束 | 块数 =', chunkCount, '| 长度 =', full.length);
  } catch (err) {
    DBG.err('请求异常:', err);
    onDelta('❌ ' + err.message);
  }
  return full;
}

// =========================================================================
