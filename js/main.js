// =========================================================================
// main.js —— 入口：装配事件与初始化
// =========================================================================
import { DBG, HOST, flashToast, state, view } from './state.js';
import {
  activeCanvasId, createCanvas, duplicateCanvas, ensureRepo, listCanvases,
  removeCanvas, renameCanvas, switchCanvas,
} from './canvases.js';
import { addMsg, bindSidebar, clearChat, refreshSnapshot } from './chat.js';
import { addEdge, layoutEdgeLabel, redrawEdges } from './edges.js';
import { bindCanvasDrop, importFiles, importFromUrl } from './io1.js';
import { autosaveCanvas, exportCanvasData, exportToFile, flushCanvas, importFromFile, restoreCanvas } from './io2.js';
import { bindMiniMapClick, drawMiniMap } from './minimap.js';
import { createNode, selectNode } from './nodes.js';
import { refreshLevelFilter, refreshOutline } from './outline.js';
import { runAll, runSelection } from './run.js';
import { createTask, loadTasks, refreshTasks, switchOlTab } from './tasks.js';
import { applyView, canvasEl, centerContent, fitToContent, screenToWorld, zoomAt } from './viewport.js';
import { createZone } from './zones.js';
import {
  bindFavorites, favoriteSelectedNode, favoriteSubgraph, importFavorite, listFavoriteNodes,
  openFavoritesPanel, refreshFavoritesPanel, removeFavorite, restoreNode,
  restoreSubgraph, showFavorite, viewportCenterWorld,
} from './favorites.js';

// =========================================================================
// 12.0 多画布：选择器 + 管理菜单
// =========================================================================

// 窄屏抽屉互斥：两侧栏各占 78vw，同时展开必然互相遮挡（共 156vw），
// 后开的会盖住先开的头部，连自己的 ✕ 都点不到。抽屉本就是互斥交互，
// 所以打开一侧时自动收起另一侧。
// 定义在模块顶层，供 main.js 与 chat.js（bindSidebar）共同使用。
HOST.closeDrawerOthers = (except) => {
  if (!HOST.matchMedia || !HOST.matchMedia('(max-width: 1024px)').matches) return;
  for (const id of ['outline', 'sidebar']) {
    if (id === except) continue;
    const el = document.getElementById(id);
    if (el) el.classList.add('collapsed');
  }
};

// 把仓库里的画布清单同步到 <select>
function refreshCanvasPicker() {
  const sel = document.getElementById('canvasPicker');
  if (!sel) return;
  const cur = activeCanvasId();
  sel.innerHTML = '';
  for (const c of listCanvases()) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }
  const curName = listCanvases().find(c => c.id === cur)?.name || '—';
  const label = document.getElementById('cpCurrent');
  if (label) label.textContent = curName;
}

// 切换画布后：重算连线、小地图、大纲与快照（等价于一次轻量 reload）
function afterCanvasSwitch() {
  applyView();
  redrawEdges();
  drawMiniMap();
  refreshOutline();
  refreshLevelFilter();
  refreshSnapshot();
  refreshCanvasPicker();
  // 对话历史不跟随画布：不清掉会把上一张图的讨论带进新画布的上下文
  clearChat();
}

function bindCanvasPicker() {
  const sel = document.getElementById('canvasPicker');
  const menuBtn = document.getElementById('canvasMenu');
  const panel = document.getElementById('canvasPanel');
  if (!sel || !menuBtn || !panel) return;

  // ---- 切换 ----
  sel.addEventListener('change', () => {
    if (!switchCanvas(sel.value)) {
      flashToast('❌ 画布不存在');
      refreshCanvasPicker();
      return;
    }
    afterCanvasSwitch();
    flashToast('已切换到：' + (listCanvases().find(c => c.id === sel.value)?.name || ''));
  });

  // ---- 管理浮层 ----
  const openPanel = () => {
    const r = menuBtn.getBoundingClientRect();
    panel.classList.add('show');
    // 贴着按钮上方展开；越界则夹紧到视口内（窄屏工具栏在底部）
    const pr = panel.getBoundingClientRect();
    let left = Math.min(r.left, window.innerWidth - pr.width - 8);
    let top = r.top - pr.height - 6;
    if (top < 8) top = Math.min(r.bottom + 6, window.innerHeight - pr.height - 8);
    panel.style.left = Math.max(8, left) + 'px';
    panel.style.top = Math.max(8, top) + 'px';
    refreshCanvasPicker();
  };
  const closePanel = () => panel.classList.remove('show');

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel.classList.contains('show')) closePanel(); else openPanel();
  });
  // 点面板内部不关；点外部关闭；Esc 也关
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  document.getElementById('cpNew').addEventListener('click', () => {
    const name = prompt('新画布名称：', '画布 ' + (listCanvases().length + 1));
    if (name === null) return;          // 取消
    createCanvas(name.trim() || undefined);
    afterCanvasSwitch();
    closePanel();
    flashToast('✅ 已新建画布');
  });

  document.getElementById('cpRename').addEventListener('click', () => {
    const id = activeCanvasId();
    const cur = listCanvases().find(c => c.id === id);
    if (!cur) return;
    const name = prompt('重命名画布：', cur.name);
    if (name === null) return;
    renameCanvas(id, name);
    refreshCanvasPicker();
    flashToast('✅ 已重命名');
  });

  document.getElementById('cpDuplicate').addEventListener('click', () => {
    const id = activeCanvasId();
    const copy = duplicateCanvas(id);
    if (!copy) return;
    switchCanvas(copy);
    afterCanvasSwitch();
    closePanel();
    flashToast('✅ 已复制为副本');
  });

  document.getElementById('cpDelete').addEventListener('click', () => {
    const id = activeCanvasId();
    const cur = listCanvases().find(c => c.id === id);
    if (!cur) return;
    if (listCanvases().length <= 1) {
      // 删最后一张会自动补一张空白的，语义上等于「清空重来」，需说清楚
      if (!confirm(`只剩一张画布。删除会新建一张空白画布，当前内容将丢失。继续？`)) return;
    } else if (!confirm(`删除画布「${cur.name}」？此操作不可撤销（建议先「⬇ 导出」备份）。`)) return;
    if (!removeCanvas(id)) return;
    afterCanvasSwitch();
    closePanel();
    flashToast('🗑 已删除画布');
  });
}

// =========================================================================
// 12.0b 框选收藏（只收藏一部分节点和边）
// =========================================================================
// 进入框选模式后，在画布上拖出矩形，松手即收藏框内节点与
// 「两端都在框内」的边（闭包由 subgraph.js 保证）。
function bindSubgraphSelect() {
  const btn = document.getElementById('favSubgraph');
  const canvas = document.getElementById('canvas');
  const box = document.getElementById('selectBox');
  const hint = document.getElementById('selectHint');
  if (!btn || !canvas || !box) return;

  let selecting = false;

  const setMode = (on) => {
    selecting = on;
    canvas.classList.toggle('selecting', on);
    if (hint) hint.hidden = !on;
    if (!on) box.hidden = true;
    btn.classList.toggle('running', on);
  };

  btn.addEventListener('click', () => setMode(!selecting));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selecting) setMode(false);
  });

  // 捕获阶段拦截：框选模式下不允许画布平移，否则拖拽会变成移动画布
  canvas.addEventListener('pointerdown', (e) => {
    if (!selecting || e.button !== 0) return;
    // 点在节点上也不进入节点拖动，统一按框选处理
    e.stopPropagation();
    e.preventDefault();

    const cRect = canvas.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    box.hidden = false;
    const paint = (x1, y1, x2, y2) => {
      box.style.left = Math.min(x1, x2) - cRect.left + 'px';
      box.style.top = Math.min(y1, y2) - cRect.top + 'px';
      box.style.width = Math.abs(x2 - x1) + 'px';
      box.style.height = Math.abs(y2 - y1) + 'px';
    };
    paint(sx, sy, sx, sy);

    const onMove = (ev) => paint(sx, sy, ev.clientX, ev.clientY);
    const onUp = async (ev) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      box.hidden = true;
      setMode(false);

      // 屏幕坐标 -> world 坐标
      const p1 = screenToWorld(sx, sy);
      const p2 = screenToWorld(ev.clientX, ev.clientY);
      const rect = {
        x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y),
        w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y),
      };
      if (rect.w < 4 || rect.h < 4) return;   // 误点，不当作框选

      try {
        const id = await favoriteSubgraph(rect);
        if (id) await refreshFavoritesPanel();
      } catch (err) {
        DBG.err('框选收藏失败：', err);
        flashToast('❌ ' + err.message);
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }, true);
}

// 12. 初始化
// =========================================================================
function init() {
  // API Key 记忆
  const savedKey = localStorage.getItem('deepseek_key');
  if (savedKey) document.getElementById('apiKey').value = savedKey;
  document.getElementById('apiKey').addEventListener('change', (e) => {
    localStorage.setItem('deepseek_key', e.target.value.trim());
  });

  // 新建的文档节点应当是空的：提示语交给 textarea 的 placeholder，
  // 不能写进 text，否则用户每次都得先全选删掉（历史问题）。
  document.getElementById('addDoc').addEventListener('click', () =>
    createNode('doc', { x: 120, y: 120 }));
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
    if (flushCanvas()) {
      DBG.log('已保存到本地');
      flashToast('✅ 已保存');
    } else {
      alert('保存失败（图片可能太大，请用「⬇ 导出」存成文件）');
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
  // ---- 窄屏抽屉互斥 ----
  document.getElementById('toggleOutline').addEventListener('click', () => {
    const el = document.getElementById('outline');
    el.classList.toggle('collapsed');
    if (!el.classList.contains('collapsed')) HOST.closeDrawerOthers?.('outline');
    requestAnimationFrame(() => { redrawEdges(); drawMiniMap(); });
  });

  // 窄屏抽屉的收起按钮（展开时外部 toggle 会隐藏，靠这个收回）
  const collapsePanel = (id) => {
    document.getElementById(id).classList.add('collapsed');
    requestAnimationFrame(() => { redrawEdges(); drawMiniMap(); });
  };
  document.getElementById('olClose')?.addEventListener('click', () => collapsePanel('outline'));
  document.getElementById('sbClose')?.addEventListener('click', () => collapsePanel('sidebar'));

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
  bindFavorites();
  bindSubgraphSelect();

  // 节点标题栏的 ⭐：nodes.js 不能直接 import favorites（会形成循环依赖，
  // 且单文件构建靠函数声明顺序拼接），故通过 HOST 注入回调。
  HOST.favoriteNodeById = async (nodeId) => {
    const prev = state.selectedNodeId;
    selectNode(nodeId);
    const fid = await favoriteSelectedNode();
    if (!fid && prev) selectNode(prev);
    return fid;
  };

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
  ensureRepo();
  bindCanvasPicker();
  const restored = restoreCanvas();
  refreshCanvasPicker();
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
    flushCanvas();          // 示例内容立刻归属于当前画布，避免切换后被空白覆盖
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
