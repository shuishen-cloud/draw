// =========================================================================
// e2e_dev_cache.cjs —— dev-cache-header 的验证
//
//   运行：node tests/e2e_dev_cache.cjs
//
// 验证 server.js 的静态响应带禁缓存头，且内容始终来自磁盘最新版本。
// 为避免干扰开发中的 8090 实例，测试在 8099 启动独立服务；
// 可用 PORT / SERVER_PORT 覆盖。
// =========================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const PORT = Number(process.env.TEST_PORT || 8099);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✖', name, extra); }
}

// 简易 GET，返回 { status, headers, body }
function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + p, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
  });
}

function waitReady(retries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      get('/').then(() => resolve()).catch(() => {
        if (++n >= retries) return reject(new Error('服务未就绪'));
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

// 带缓存头的判定
function hasNoStore(headers) {
  const cc = String(headers['cache-control'] || '');
  return /no-store/i.test(cc) && /must-revalidate/i.test(cc);
}

(async () => {
  // 启动独立服务实例
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => { exited = true; });

  const cleanup = () => {
    if (!exited) { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
  };

  try {
    await waitReady();
    console.log(`\n[0] 测试服务已启动于 ${BASE}`);

    console.log('\n[1] 静态 JS 响应头');
    const js = await get('/js/main.js');
    check('状态 200', js.status === 200, String(js.status));
    check('cache-control 含 no-store + must-revalidate',
          hasNoStore(js.headers), js.headers['cache-control']);
    check('pragma: no-cache', /no-cache/i.test(String(js.headers['pragma'] || '')),
          String(js.headers['pragma']));
    check('expires: 0', String(js.headers['expires'] || '').trim() === '0',
          String(js.headers['expires']));

    console.log('\n[2] 其它静态资源同样禁缓存');
    for (const p of ['/', '/styles.css', '/js/md.js', '/js/geom.js']) {
      const r = await get(p);
      check(`${p} 带 no-store`, hasNoStore(r.headers),
            `${r.status} ${r.headers['cache-control']}`);
    }

    console.log('\n[3] 404 响应也禁缓存');
    const nf = await get('/__no_such_file__.js');
    check('404 状态', nf.status === 404, String(nf.status));
    check('404 带 no-store', hasNoStore(nf.headers), nf.headers['cache-control']);

    console.log('\n[4] 内容即时性：改文件后立刻反映');
    const target = path.join(ROOT, 'js', 'md.js');
    const original = fs.readFileSync(target, 'utf8');
    const marker = 'DEV_CACHE_TEST_MARKER_' + Date.now();
    try {
      fs.writeFileSync(target, original.replace(
        '// md.js —— ', `// ${marker}\n// md.js —— `), 'utf8');
      const after = await get('/js/md.js');
      check('修改后立即返回新内容', after.body.includes(marker),
            '未找到 marker');
    } finally {
      fs.writeFileSync(target, original, 'utf8');
    }
    const restored = await get('/js/md.js');
    check('还原后返回原内容', !restored.body.includes(marker));

    console.log('\n[5] 两次请求内容一致（服务端不缓存内容）');
    const a = await get('/js/geom.js');
    const b = await get('/js/geom.js');
    check('两次内容相同', a.body === b.body, `${a.body.length} vs ${b.body.length}`);
    check('两次都带 no-store', hasNoStore(a.headers) && hasNoStore(b.headers));

    console.log('\n[6] proxy 接口也不缓存');
    const px = await get('/proxy');
    check('/proxy 响应带 no-store', hasNoStore(px.headers),
          `${px.status} ${px.headers['cache-control']}`);

    console.log(`\n结果：${pass} 通过，${fail} 失败`);
  } catch (e) {
    console.error('测试异常:', e.message);
    fail++;
  } finally {
    cleanup();
  }
  process.exit(fail ? 1 : 0);
})();
