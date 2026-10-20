import { DBG, escapeHtml, seq, state, view } from './state.js';
import { bindLinkHandle, layoutEdgeLabel, redrawEdges } from './edges.js';
import { renderMarkdown } from './md.js';
import { readAsDataURL } from './io1.js';
import { applyFilter, refreshOutline } from './outline.js';
import { runExecNode } from './run.js';
import { worldEl } from './viewport.js';
// 2. 节点增删
// =========================================================================
export function createNode(kind, opts = {}) {
  const id = 'n' + (++seq.node);
  const titles = { output: '输出', img: '图片', doc: '文档', exec: '执行' };
  const node = {
    id,
    kind,                                  // 'doc' | 'output' | 'img' | 'exec'
    title: opts.title || titles[kind] || '节点',
    x: opts.x ?? (80 + (seq.node % 6) * 40),
    y: opts.y ?? (80 + (seq.node % 6) * 40),
    w: opts.w ?? (kind === 'img' ? 240 : kind === 'exec' ? 320 : 300),
    h: opts.h ?? (kind === 'img' ? 200 : kind === 'exec' ? 220 : 160),
    text: opts.text ?? '',
    src: opts.src ?? '',                   // 图片节点的 dataURL
    prompt: opts.prompt ?? '',             // 执行节点的提示词（写在节点内）
    zoneId: opts.zoneId ?? null,           // 手动归属的区域
    level: opts.level ?? 1,                // 大纲层级（预留）
    el: null,
  };
  state.nodes[id] = node;
  renderNode(node);                        // 创建 DOM
  layoutNode(node);
  if (!window.__silentImport) refreshOutline();
  DBG.log('创建节点', id, kind, 'zone=', node.zoneId);
  if (!window.__silentImport) window.scheduleSnapshot?.();
  return node;
}

export function removeNode(id) {
  const node = state.nodes[id];
  if (!node) return;
  // 删除所有与之相连的边
  Object.values(state.edges)
    .filter(e => e.source === id || e.target === id)
    .forEach(e => removeEdge(e.id));
  node.el.remove();
  delete state.nodes[id];
  refreshOutline();
  DBG.log('删除节点', id);
}

export function removeEdge(id) {
  const e = state.edges[id];
  if (!e) return;
  e.labelEl?.remove();
  if (state.selectedEdgeId === id) state.selectedEdgeId = null;
  delete state.edges[id];
  DBG.log('删除连线', id);
}

// =========================================================================
// 3. 节点 DOM 创建与布局
// =========================================================================
export function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'node';
  el.id = 'node-' + node.id;
  el.dataset.kind = node.kind;
  el.innerHTML = `
    <div class="bar">
      <span class="dot"></span>
      <span class="title"></span>
      <button class="md-toggle" type="button" title="切换 编辑 / 预览">预览</button>
      <select class="zone-pick" title="归属区域（大纲章节）"></select>
      <span class="close" title="删除节点">×</span>
    </div>
    <div class="body"></div>
    <div class="md-view" hidden></div>
    <div class="port port-in"  title="输入（可视提示）"></div>
    <div class="port port-out" title="拖出连线（整个节点都可拖）"></div>
    <div class="edge-hot" data-side="left"></div>
    <div class="edge-hot" data-side="right"></div>
    <div class="edge-hot" data-side="top"></div>
    <div class="edge-hot" data-side="bottom"></div>
    <div class="resize-handle" title="拖拽调整大小"></div>
  `;
  el.querySelector('.title').textContent = node.title;

  const body = el.querySelector('.body');
  if (node.kind === 'img') {
    // 图片节点：支持文件选择 / 拖拽 / 粘贴
    const img = document.createElement('img');
    img.alt = '';
    if (node.src) { img.src = node.src; el.classList.add('has-img'); }
    const drop = document.createElement('div');
    drop.className = 'img-drop';
    drop.textContent = '拖入 / 点击选择 / 粘贴图片';
    drop.title = '图片节点可作为连线源，交给视觉模型识别';
    body.appendChild(img);
    body.appendChild(drop);
    node.imgEl = img;
    el.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => inp.files[0] && loadImageFile(node, inp.files[0]);
      inp.click();
    });
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault(); el.classList.add('drop-target');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      if (f) { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop-target'); loadImageFile(node, f); }
    });
    // 粘贴（聚焦该节点时）
    el.addEventListener('paste', (e) => {
      const f = [...(e.clipboardData?.items || [])]
        .find(i => i.type.startsWith('image/'))?.getAsFile();
      if (f) { e.preventDefault(); loadImageFile(node, f); }
    });
    el.tabIndex = 0;
  } else if (node.kind === 'output') {
    const out = document.createElement('div');
    out.className = 'out empty';
    out.contentEditable = 'true';           // 允许手动改
    body.appendChild(out);
    node.textEl = out;
    out.addEventListener('input', () => {
      node.text = out.textContent;
      out.classList.toggle('empty', !node.text);
      window.scheduleSnapshot?.();
    });
  } else if (node.kind === 'exec') {
    // 执行节点：上方提示词（写在节点内），下方执行结果
    const inlabel = document.createElement('div');
    inlabel.className = 'exec-inlabel';
    inlabel.textContent = '提示词（多输入聚合）';
    const prompt = document.createElement('textarea');
    prompt.className = 'exec-prompt';
    prompt.placeholder = '例如：对比以下多段内容，提炼共同结论…';
    prompt.value = node.prompt || '';
    prompt.addEventListener('input', () => {
      node.prompt = prompt.value;
      window.scheduleSnapshot?.();
    });
    const out = document.createElement('div');
    out.className = 'exec-out empty';
    body.appendChild(prompt);
    body.appendChild(out);
    node.promptEl = prompt;
    node.textEl = out;      // 结果写入这里
    body.style.flexDirection = 'column';
    // 把标签放到最前（在 body 之前展示）
    body.parentNode.insertBefore(inlabel, body);
    // 执行节点可点击自身运行
    el.querySelector('.title').addEventListener('dblclick', (e) => {
      e.stopPropagation(); runExecNode(node.id);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.placeholder = '在这里输入文档内容…';
    ta.value = node.text;
    body.appendChild(ta);
    node.textEl = ta;
    ta.addEventListener('input', () => {
      node.text = ta.value;
      window.scheduleSnapshot?.();
      redrawEdges();                        // 内容变化可能改变节点尺寸，重画连线
    });
  }

  // 移动 + 选中
  const bar = el.querySelector('.bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('close')) return;
    if (e.target.classList.contains('zone-pick')) return;
    selectNode(node.id);
    startDrag(e, node);
  });
  el.addEventListener('pointerdown', () => selectNode(node.id));

  // 删除节点
  el.querySelector('.close').addEventListener('click', (e) => {
    e.stopPropagation();
    removeNode(node.id);
    redrawEdges();
    window.scheduleSnapshot?.();
  });

  // 连线：两个端口都是「拖出」热区（视觉上区分左右，语义上不限制方向）
  bindLinkHandle(node, el.querySelector('.port-out'));
  bindLinkHandle(node, el.querySelector('.port-in'));
  // 边框热区：节点四周 8px 的不可见条带，手指粗也能拖出连线
  el.querySelectorAll('.edge-hot').forEach(hot => {
    bindLinkHandle(node, hot);
  });

  // 缩放手柄
  el.querySelector('.resize-handle').addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    startResize(e, node);
  });

  // 区域选择器：手动指定节点归属哪个区域（大纲章节）
  const pick = el.querySelector('.zone-pick');
  pick.addEventListener('pointerdown', (e) => e.stopPropagation());
  pick.addEventListener('change', () => {
    node.zoneId = pick.value || null;
    DBG.log('节点', node.id, '归属区域 ->', node.zoneId);
    refreshOutline();
    applyFilter();
    window.scheduleSnapshot?.();
  });
  node.zonePickEl = pick;

  // ---- Markdown 预览切换 ----
  const mdToggle = el.querySelector('.md-toggle');
  if (node.kind === 'img') {
    mdToggle.remove();              // 图片节点无文本，不需要预览
  } else {
    mdToggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    mdToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setNodeMode(node, node.el.dataset.mode === 'preview' ? 'edit' : 'preview');
    });
  }
  el.dataset.mode = 'edit';

  // 预览态下点击内容区 → 切回编辑（“点一下就能改”）
  el.querySelector('.md-view').addEventListener('click', (e) => {
    if (el.dataset.mode !== 'preview') return;
    // 允许点链接不触发（否则无法跳转）
    if (e.target.closest('a')) return;
    e.stopPropagation();
    setNodeMode(node, 'edit');
  });

  worldEl().appendChild(el);   // 节点进入 world 坐标系
  node.el = el;
  refreshZonePicker(node);     // 初始化下拉选项
}

// 刷新单个节点的区域下拉选项（区域增删后调用）
export function refreshZonePicker(node) {
  const pick = node.zonePickEl;
  if (!pick) return;
  const cur = node.zoneId || '';
  const opts = ['<option value="">未分类</option>'];
  for (const z of Object.values(state.zones)) {
    opts.push(`<option value="${z.id}">${escapeHtml(z.title)}</option>`);
  }
  pick.innerHTML = opts.join('');
  pick.value = state.zones[cur] ? cur : '';
  if (cur && !state.zones[cur]) node.zoneId = null;
}

export function refreshAllZonePickers() {
  Object.values(state.nodes).forEach(refreshZonePicker);
}


// 把图片文件读成 dataURL 挂到图片节点上
export function loadImageFile(node, file) {
  const reader = new FileReader();
  reader.onload = () => {
    node.src = reader.result;
    node.imgEl.src = node.src;
    node.el.classList.add('has-img');
    window.scheduleSnapshot?.();
    DBG.log('图片载入', node.id, file.name, Math.round(file.size / 1024) + 'KB');
  };
  reader.readAsDataURL(file);
}

// 切换节点显示模式：'edit'（源码）| 'preview'（Markdown 渲染）
// 状态仅存 DOM（node.el.dataset.mode），不写入导出 JSON。
export function setNodeMode(node, mode) {
  const el = node.el;
  if (!el) return;
  const view = el.querySelector('.md-view');
  const body = el.querySelector('.body');
  const toggle = el.querySelector('.md-toggle');
  if (!view || !body) return;

  el.dataset.mode = mode;
  const preview = mode === 'preview';

  if (preview) {
    // 取当前文本：doc/output/exec 的正文与提示词都算内容
    const src = [node.text || '', node.prompt || ''].filter(Boolean).join('\n\n');
    const html = renderMarkdown(src);
    view.innerHTML = html || '<p class="md-empty">（无内容）</p>';
    view.hidden = false;
    body.hidden = true;
    DBG.log('切换预览', node.id, '原文', src.length, '字 -> HTML', html.length);
  } else {
    view.hidden = true;
    view.innerHTML = '';
    body.hidden = false;
    DBG.log('切回编辑', node.id);
  }
  if (toggle) toggle.textContent = preview ? '编辑' : '预览';
  el.classList.toggle('previewing', preview);
}

export function layoutNode(node) {
  const el = node.el;
  if (!el) return;
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.width = node.w + 'px';
  el.style.height = node.h + 'px';
}

export function selectNode(id) {
  Object.values(state.nodes).forEach(n => n.el.classList.toggle('selected', n.id === id));
}

// =========================================================================
// 4. 拖拽移动
// =========================================================================
export function startDrag(e, node) {
  const startX = e.clientX, startY = e.clientY;
  const origX = node.x, origY = node.y;
  function onMove(ev) {
    // 除以 scale：鼠标在屏幕上动 1px，节点在 world 中只应动 1/scale
    node.x = origX + (ev.clientX - startX) / view.scale;
    node.y = origY + (ev.clientY - startY) / view.scale;
    layoutNode(node);
    redrawEdges();
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.scheduleSnapshot?.();   // 拖动结束保存位置
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// =========================================================================
// 5. 拖拽缩放
// =========================================================================
export function startResize(e, node) {
  const startX = e.clientX, startY = e.clientY;
  const ow = node.w, oh = node.h;
  function onMove(ev) {
    // 同样按 scale 换算
    node.w = Math.max(120, ow + (ev.clientX - startX) / view.scale);
    node.h = Math.max(80,  oh + (ev.clientY - startY) / view.scale);
    layoutNode(node);
    redrawEdges();
    layoutEdgeLabel(node);      // 若此节点是端点，标签位置也要更新
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.scheduleSnapshot?.();   // 缩放结束保存尺寸
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// =========================================================================
