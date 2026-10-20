// =========================================================================
// main.js —— 入口：装配事件与初始化
// =========================================================================
import { DBG, flashToast, state, view } from './state.js';
import { addMsg, bindSidebar, refreshSnapshot } from './chat.js';
import { addEdge, layoutEdgeLabel, redrawEdges } from './edges.js';
import { bindCanvasDrop, importFiles, importFromUrl } from './io1.js';
import { autosaveCanvas, exportCanvasData, exportToFile, importFromFile, restoreCanvas } from './io2.js';
import { bindMiniMapClick, drawMiniMap } from './minimap.js';
import { createNode } from './nodes.js';
import { refreshLevelFilter, refreshOutline } from './outline.js';
import { runAll, runSelection } from './run.js';
import { createTask, loadTasks, refreshTasks, switchOlTab } from './tasks.js';
import { applyView, canvasEl, centerContent, fitToContent, zoomAt } from './viewport.js';
import { createZone } from './zones.js';

// 12. 初始化
// =========================================================================
function init() {
  // API Key 记忆
  const savedKey = localStorage.getItem('deepseek_key');
  if (savedKey) document.getElementById('apiKey').value = savedKey;
  document.getElementById('apiKey').addEventListener('change', (e) => {
    localStorage.setItem('deepseek_key', e.target.value.trim());
  });

  document.getElementById('addDoc').addEventListener('click', () =>
    createNode('doc', { x: 120, y: 120, text: '在这里输入要处理的文档…' }));
  document.getElementById('addOutput').addEventListener('click', () =>
    createNode('output', { x: 560, y: 120 }));
  document.getElementById('addImg').addEventListener('click', () =>
    createNode('img', { x: 560, y: 340 }));
  document.getElementById('addExec').addEventListener('click', () =>
    createNode('exec', { x: 300, y: 420 }));

  // ---- 左侧 Tab 与任务 ----
  document.querySelectorAll('.ol-tab').forEach(el =>
    el.addEventListener('click', () => switchOlTab(el.dataset.tab)));
  document.getElementById('addTask').addEventListener('click', () => {
    const name = prompt('任务名称：', '任务 ' + (Object.keys(state.tasks).length + 1));
    if (name === null) return;
    // 以当前选中的连线作为初始成员
    const init = state.selectedEdgeId ? [state.selectedEdgeId] : [];
    state.activeTaskId = createTask(name, init).id;
    refreshTasks();
  });

  // ---- 本地资料导入 ----
  document.getElementById('importFiles').addEventListener('click', () =>
    document.getElementById('filePicker').click());
  document.getElementById('filePicker').addEventListener('change', (e) => {
    if (e.target.files.length) importFiles(e.target.files);
    e.target.value = '';   // 允许重复选同一文件
  });
  document.getElementById('importUrl').addEventListener('click', () => importFromUrl());
  bindCanvasDrop();

  // ---- 保存 / 导出 / 导入 ----
  document.getElementById('saveCanvas').addEventListener('click', () => {
    try {
      localStorage.setItem('mc_canvas', JSON.stringify(exportCanvasData()));
      DBG.log('已保存到本地');
      flashToast('✅ 已保存');
    } catch (e) {
      alert('保存失败（图片可能太大，请用「⬇ 导出」存成文件）：' + e.message);
    }
  });
  document.getElementById('exportJson').addEventListener('click', exportToFile);
  document.getElementById('importJson').addEventListener('click', () =>
    document.getElementById('jsonPicker').click());
  document.getElementById('jsonPicker').addEventListener('change', (e) => {
    if (e.target.files[0]) importFromFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('addZone').addEventListener('click', () =>
    createZone({}));
  // 全部运行：运行中再次点击 = 取消（平板上没有 Esc 键）
  let runSignal = null;
  document.getElementById('runAll').addEventListener('click', () => {
    if (runSignal) {
      runSignal.aborted = true;
      DBG.log('请求取消运行');
      flashToast('正在取消…');
      return;
    }
    runSignal = { aborted: false };
    const s = runSignal;
    runAll({
      signal: s,
      onProgress: ({ done, total }) => {
        DBG.log('运行进度', done, '/', total);
      },
    }).finally(() => {
      if (runSignal === s) runSignal = null;
    });
  });
  // 触摸设备主入口：运行当前选中的连线 / 节点
  document.getElementById('runSel').addEventListener('click', () => runSelection());
  document.getElementById('toggleOutline').addEventListener('click', () => {
    document.getElementById('outline').classList.toggle('collapsed');
    requestAnimationFrame(() => { redrawEdges(); drawMiniMap(); });
  });

  // ---- 视口控件 ----
  // 缩放锚点统一取「可见容器中心」：
  // #canvas 是绝对定位的全屏层，侧栏占位后它的中心并不在可见区中心，
  // 用它当锚点会让节点在放大后跑出视野。
  const viewCenter = () => {
    const r = document.getElementById('canvasWrap').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  document.getElementById('zoomIn').addEventListener('click', () => {
    const c = viewCenter();
    zoomAt(c.x, c.y, 1.2);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    const c = viewCenter();
    zoomAt(c.x, c.y, 1 / 1.2);
  });
  document.getElementById('fit').addEventListener('click', () => fitToContent());
  document.getElementById('reset1').addEventListener('click', () => {
    // 「100% 居中」：缩放到 1.0 并把内容居中到可见区
    view.scale = 1;
    centerContent();
  });
  document.getElementById('toggleMap').addEventListener('click', () => {
    document.getElementById('minimap').classList.toggle('hidden');
    drawMiniMap();
  });
  bindMiniMapClick();
  bindSidebar();

  // 画布变化时自动刷新侧边栏快照（节流，避免拖拽时每帧重绘）
  let snapTimer = null;
  window.scheduleSnapshot = () => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      refreshSnapshot();
      autosaveCanvas();     // 画布变化时同步自动保存
    }, 250);
  };

  // ---- 画布平移：空白处拖拽 或 空格+拖拽 ----
  const canvas = document.getElementById('canvas');
  let spaceDown = false;
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') spaceDown = true; });
  document.addEventListener('keyup',   (e) => { if (e.code === 'Space') spaceDown = false; });
  canvas.addEventListener('pointerdown', (e) => {
    const onBlank = e.target.id === 'canvas' || e.target.id === 'world' || e.target.id === 'edges';
    if (!onBlank && !spaceDown) return;
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
    canvas.classList.add('panning');
    function onMove(ev) { view.x = ox + (ev.clientX - sx); view.y = oy + (ev.clientY - sy); applyView(); }
    function onUp() {
      canvas.classList.remove('panning');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // ---- 滚轮缩放 ----
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  // ---- 触摸双指缩放（平板/手机）----
  const touches = new Map();   // pointerId -> {x, y}
  let pinchDist = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && pinchDist > 0) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) {
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        zoomAt(cx, cy, d / pinchDist);
        pinchDist = d;
      }
    }
  });
  const endTouch = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchDist = 0;
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  // 点击空白处取消选中
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target.id === 'canvas' || e.target.id === 'world' || e.target.id === 'edges') {
      state.selectedEdgeId = null;
      Object.values(state.nodes).forEach(n => n.el.classList.remove('selected'));
      redrawEdges();
    }
  });

  // 优先从本地恢复上次画布；没有则创建示例
  const restored = restoreCanvas();
  if (!restored) {
    const a = createNode('doc', { x: 100, y: 140, title: '文档', w: 340, h: 260,
      text: [
        '# 人工智能',
        '',
        '大语言模型可以：',
        '',
        '- 写代码',
        '- 做翻译',
        '- **总结**长文',
        '',
        '> 它们从海量文本中学会了语言的统计规律。',
      ].join('\n') });
    const b = createNode('output', { x: 560, y: 140, title: '输出' });
    const e1 = addEdge(a.id, b.id);
    e1.command = '🖐️总结';
    layoutEdgeLabel(e1);
    applyView();
    fitToContent();
  }

  refreshSnapshot();                    // 同步画布快照到侧边栏
  refreshOutline();                     // 初始化大纲
  loadTasks();                          // 载入已保存的任务
  refreshTasks();
  switchOlTab('outline');
  refreshLevelFilter();                 // 初始化层级过滤器
  addMsg('assistant',
    '你好，我能看到你当前的画布。可以问我：\n- 「概括当前图的结构」\n- 「N1 的内容讲了什么？」\n- 上传图片后「描述画布上的图片」',
    '助手');

  // 布局变化后重算连线（侧边栏折叠/展开、窗口尺寸变化）
  if (window.ResizeObserver) {
    new ResizeObserver(() => { redrawEdges(); drawMiniMap(); })
      .observe(document.getElementById('canvasWrap'));
  }

  window.addEventListener('resize', () => { redrawEdges(); drawMiniMap(); });

  // ---- 移动端/窄屏：默认折叠两侧栏，画布占满屏幕 ----
  if (window.matchMedia('(max-width: 1024px)').matches) {
    document.getElementById('outline').classList.add('collapsed');
    document.getElementById('sidebar').classList.add('collapsed');
    requestAnimationFrame(() => { redrawEdges(); drawMiniMap(); });
  }

  DBG.log('初始化完成。左侧：大纲/任务；Alt+Enter 运行；区域=大纲层级。');
}


init();
