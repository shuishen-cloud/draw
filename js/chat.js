import { API_URL, DBG, PREFIX, state } from './state.js';
import { redrawEdges } from './edges.js';
import { drawMiniMap } from './minimap.js';
// 11.8 画布序列化 —— 让对话能“识别整张图”
// =========================================================================
// 把当前画布（节点 + 连线）变成一段结构化文本，喂给模型。
// 包含：每个节点的类型/标题/内容（图片用占位符）、每条连线的源→目标及命令。
export function serializeCanvas(opts = {}) {
  const { maxCharsPerNode = 600 } = opts;
  const nodes = Object.values(state.nodes);
  const edges = Object.values(state.edges);

  // 给节点一个可读的稳定编号：按位置从左到右、从上到下排序
  const sorted = [...nodes].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const labelOf = new Map();
  sorted.forEach((n, i) => labelOf.set(n.id, 'N' + (i + 1)));

  const lines = [];
  lines.push('【画布结构】');

  // 区域（= 大纲层级单位）
  const zones = Object.values(state.zones);
  if (zones.length) {
    lines.push('区域（大纲层级，' + zones.length + ' 个）：');
    for (const z of zones) {
      const cnt = Object.values(state.nodes).filter(n => n.zoneId === z.id).length;
      lines.push(`- ${z.title}（${cnt} 个节点）`);
    }
  }

  lines.push('节点（' + nodes.length + ' 个）：');
  for (const n of sorted) {
    const tag = labelOf.get(n.id);
    const kind = { doc: '文档', output: '输出', img: '图片', exec: '执行' }[n.kind] || n.kind;
    const zoneName = n.zoneId && state.zones[n.zoneId] ? state.zones[n.zoneId].title : '未分类';
    let content;
    if (n.kind === 'img') {
      content = n.src ? '[图片]' : '[空图片]';
    } else if (n.kind === 'exec') {
      const p = (n.prompt || '').trim();
      const r = (n.text || '').trim();
      content = '提示词=' + (p ? JSON.stringify(p) : '(空)') +
                ' 结果=' + (r ? '"' + (r.length > maxCharsPerNode ? r.slice(0, maxCharsPerNode) + '…' : r) + '"' : '(空)');
    } else {
      const t = (n.text || '').trim();
      content = t ? '"' + (t.length > maxCharsPerNode ? t.slice(0, maxCharsPerNode) + '…(已截断)' : t) + '"' : '(空)';
    }
    lines.push(`- ${tag} [${kind}] 区域=${JSON.stringify(zoneName)} 标题=${JSON.stringify(n.title)} ${content}`);
  }

  lines.push('连线（' + edges.length + ' 条）：');
  if (!edges.length) lines.push('- （无）');
  for (const e of edges) {
    const from = labelOf.get(e.source) || e.source;
    const to   = labelOf.get(e.target) || e.target;
    const cmd  = (e.command || '').trim();
    const exec = cmd.startsWith(PREFIX) ? cmd.slice(PREFIX.length).trim() : '';
    lines.push(`- ${from} → ${to} 命令=${exec ? JSON.stringify(exec) : '(无，不执行)'}`);
  }
  return lines.join('\n');
}

// 收集画布上所有有内容的图片（dataURL），供视觉模型识别
export function collectCanvasImages() {
  return Object.values(state.nodes)
    .filter(n => n.kind === 'img' && n.src)
    .map(n => ({ id: n.id, title: n.title, src: n.src }));
}

// 刷新侧边栏顶部的“快照预览”
export function refreshSnapshot() {
  const text = serializeCanvas();
  const pre = document.getElementById('snapText');
  if (pre) pre.textContent = text;
  const chip = document.getElementById('ctxChip');
  if (chip) chip.textContent = '上下文：' + Object.keys(state.nodes).length + ' 节点 / '
    + Object.keys(state.edges).length + ' 连线';

  const thumbs = document.getElementById('snapThumbs');
  if (thumbs) {
    thumbs.innerHTML = '';
    for (const im of collectCanvasImages()) {
      const el = document.createElement('img');
      el.src = im.src; el.title = im.title;
      thumbs.appendChild(el);
    }
  }
  DBG.log('画布快照已刷新');
}

// =========================================================================
// 11.9 侧边栏对话
// =========================================================================
const chat = { messages: [], busy: false };

export function addMsg(role, text, meta) {
  const box = document.getElementById('msgs');
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (meta) {
    const m = document.createElement('span');
    m.className = 'meta'; m.textContent = meta;
    el.appendChild(m);
  }
  el.appendChild(document.createTextNode(text));
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

// 发送消息：自动把画布快照(+可选图片)拼入上下文
export async function sendChat() {
  if (chat.busy) return;
  const input = document.getElementById('chatInput');
  const userText = input.value.trim();
  if (!userText) return;
  const key = document.getElementById('apiKey').value.trim()
    || localStorage.getItem('deepseek_key') || '';
  if (!key) { alert('请先填写 DeepSeek API Key'); return; }

  const withImages = document.getElementById('includeImages').checked;
  const snapshot = serializeCanvas();
  const images = withImages ? collectCanvasImages() : [];

  // 记录并显示用户消息
  chat.messages.push({ role: 'user', text: userText });
  addMsg('user', userText, '我');
  input.value = '';

  // 构建请求：system 给角色与画布上下文；之后是历史消息
  const systemText =
    '你是一个能看画布的助手。下面是用户当前的画布（节点与连线）：\n\n' +
    snapshot + '\n\n' +
    '规则：\n' +
    '1. 回答时必须基于上述画布内容；提到节点时用 N1/N2 这样的编号。\n' +
    '2. 若消息中附带了图片，请直接识别图片内容（不要说你无法看到图片）。\n' +
    '3. 回答简洁、准确，用中文。';

  // 历史消息（只带文本），最新一条附上图片
  const history = chat.messages.map(m => ({
    role: m.role, content: m.text,
  }));
  if (images.length) {
    // 把最后一条 user 消息改成多模态
    const last = history[history.length - 1];
    last.content = [
      { type: 'text', text: last.content + '\n\n（下面是画布上的图片，请结合它们回答）' },
      ...images.map(im => ({ type: 'image_url', image_url: { url: im.src } })),
    ];
  }

  const payload = {
    model: 'deepseek-chat',
    stream: true,
    temperature: 0.3,
    messages: [{ role: 'system', content: systemText }, ...history],
  };

  DBG.lastRequest = payload;
  DBG.log('对话请求', { 节点数: Object.keys(state.nodes).length, 图片数: images.length });

  chat.busy = true;
  const btn = document.getElementById('sendMsg');
  btn.disabled = true;
  const bubble = addMsg('assistant', '', '助手');
  bubble.textContent = '…';

  let full = '';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const s0 of lines) {
        const s = s0.trim();
        if (!s.startsWith('data:')) continue;
        const p = s.slice(5).trim();
        if (p === '[DONE]') continue;
        try {
          const j = JSON.parse(p);
          const d = j.choices?.[0]?.delta?.content || '';
          if (d) { full += d; bubble.textContent = full; }
        } catch {}
      }
    }
    chat.messages.push({ role: 'assistant', text: full });
    DBG.log('对话完成，', full.length, '字');
  } catch (err) {
    DBG.err('对话失败:', err);
    bubble.className = 'msg error';
    bubble.textContent = '❌ ' + err.message;
  } finally {
    chat.busy = false;
    btn.disabled = false;
    document.getElementById('msgs').scrollTop = 1e9;
  }
}

export function bindSidebar() {
  document.getElementById('sendMsg').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  document.getElementById('clearChat').addEventListener('click', () => {
    chat.messages = [];
    document.getElementById('msgs').innerHTML = '';
    DBG.log('对话已清空');
  });
  document.getElementById('toggleSidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    // 布局变化后要重画（画布宽度改变会影响连线坐标）
    requestAnimationFrame(() => { redrawEdges(); drawMiniMap(); });
  });
}

// =========================================================================
