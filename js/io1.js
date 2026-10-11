import { DBG, state } from './state.js';
import { redrawEdges } from './edges.js';
import { createNode } from './nodes.js';
import { refreshOutline } from './outline.js';
import { fitToContent } from './viewport.js';
// 11.95 引入本地资料：文件导入 / URL 抓取 / 拖放到画布
// =========================================================================
const TEXT_EXT = ['txt','md','markdown','csv','json','log','js','ts','jsx','tsx','py',
  'html','css','xml','yaml','yml','ini','conf','sh','java','go','rs','c','cpp','sql'];

// 找到一块空位，避免新节点重叠
export function findFreeSpot(w = 300, h = 180) {
  const nodes = Object.values(state.nodes);
  if (!nodes.length) return { x: 160, y: 160 };
  // 取最右节点的右侧
  let maxRight = -Infinity, topY = 0;
  for (const n of nodes) {
    if (n.x + n.w > maxRight) { maxRight = n.x + n.w; topY = n.y; }
  }
  return { x: maxRight + 60, y: topY };
}

// 依据文件类型创建节点
export async function importFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const spot = findFreeSpot();

  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataURL(file);
    const node = createNode('img', { x: spot.x, y: spot.y, title: file.name, src: dataUrl });
    return node;
  }

  if (TEXT_EXT.includes(ext) || file.type.startsWith('text/')) {
    const text = await readAsText(file);
    const node = createNode('doc', {
      x: spot.x, y: spot.y, title: file.name,
      text: text.slice(0, 100000),   // 限制单节点长度
    });
    DBG.log('导入文本文件', file.name, text.length, '字');
    return node;
  }

  // 其他类型：尝试当文本读
  try {
    const text = await readAsText(file);
    return createNode('doc', { x: spot.x, y: spot.y, title: file.name, text: text.slice(0, 100000) });
  } catch {
    alert(`不支持的文件类型：${file.name}`);
    return null;
  }
}

export function readAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });
}
export function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// 批量导入
export async function importFiles(files) {
  const list = [...files];
  DBG.log('开始导入', list.length, '个文件');
  for (const f of list) {
    try { await importFile(f); }
    catch (e) { DBG.err('导入失败', f.name, e); }
  }
  redrawEdges();
  fitToContent();
  refreshOutline();
  window.scheduleSnapshot?.();
  DBG.log('导入完成');
}

// 从 URL 抓取
export async function importFromUrl(url) {
  if (!url) url = prompt('输入要引入的网页地址：', 'https://');
  if (!url || !/^https?:\/\//.test(url)) return;
  DBG.log('抓取 URL', url);
  const spot = findFreeSpot();
  const node = createNode('doc', { x: spot.x, y: spot.y, title: '加载中…', text: '正在抓取 ' + url + ' …' });
  try {
    const res = await fetch('/proxy?url=' + encodeURIComponent(url));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    node.title = (data.title || url).slice(0, 60);
    node.el.querySelector('.title').textContent = node.title;
    node.text = `【来源】${data.url}\n\n${data.text}`;
    node.textEl.value = node.text;
    DBG.log('抓取成功', node.title, node.text.length, '字');
    redrawEdges(); refreshOutline(); window.scheduleSnapshot?.();
  } catch (e) {
    node.text = '❌ 抓取失败：' + e.message + '\n（请确认本地服务已启动：node server.js）';
    node.textEl.value = node.text;
    DBG.err('抓取失败', e);
  }
}

// 拖文件到画布空白处 → 自动创建节点
export function bindCanvasDrop() {
  const wrap = document.getElementById('canvasWrap');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(ev => wrap.addEventListener(ev, (e) => {
    if (e.dataTransfer?.types?.includes('Files')) { stop(e); wrap.classList.add('dropping'); }
  }));
  ['dragleave', 'drop'].forEach(ev => wrap.addEventListener(ev, (e) => {
    if (ev === 'dragleave' && e.relatedTarget && wrap.contains(e.relatedTarget)) return;
    wrap.classList.remove('dropping');
  }));
  wrap.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    stop(e);
    // 图片拖到已存在的图片节点上时，交给节点自身处理（不新建）
    const onNode = e.target.closest && e.target.closest('.node');
    if (onNode && files.length === 1 && files[0].type.startsWith('image/')) return;
    await importFiles(files);
  });
}

// =========================================================================
