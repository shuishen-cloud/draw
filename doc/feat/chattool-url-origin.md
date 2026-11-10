# 从 ChatTool 拉取的地址按部署来源推断（chattool-url-origin）

## 1. 背景

`js/chattool.js:15` 把 ChatTool 的收藏导出地址写死成：

```js
export const CHATTOOL_DRAW_URL = 'http://127.0.0.1:8765/api/favorites/draw';
```

`127.0.0.1` 的语义是「**打开页面的这台设备自己**」，不是「ChatTool 所在的那台机器」。
ChatTool 部署到服务器之后：

| 从哪里打开 draw | `127.0.0.1:8765` 实际指向 | 结果 |
|---|---|---|
| 电脑浏览器打开 `https://域名/` | 用户自己的电脑 | 电脑上没跑 ChatTool → 连接被拒 |
| 手机浏览器打开 `https://域名/` | 手机自己 | 手机上根本没有服务 → 必然失败 |

即「📥 从 ChatTool 拉取」**必然失效**，请求根本没离开用户设备。

更糟的是错误提示会误导排查方向。`favorites.js` 里：

```js
const hint = /Failed to fetch|NetworkError|load failed/i.test(String(e.message))
  ? '连不上 ChatTool（' + url + '）。请确认 ChatTool 已启动，或改用 ChatTool 的「导出」再点「⬆ 导入」。'
```

ChatTool 明明在服务器上跑得好好的，提示却说「请确认已启动」，
用户会去查服务器，而真正的原因是浏览器在连 localhost。

## 2. 设计

### 2.1 三种运行形态

| 形态 | `location.protocol` | `location.hostname` | 应连的地址 |
|---|---|---|---|
| 服务器部署（ChatTool 在 `/8000`） | `https:` | `域名` | `https://域名/8000/api/favorites/draw` |
| 本机开发（`node server.js`） | `http:` | `localhost` 或 `127.0.0.1` | `http://127.0.0.1:8765/api/favorites/draw` |
| 单文件离线版（`file://`） | `file:` | 空 | `http://127.0.0.1:8765/api/favorites/draw` |

后两种必须与原行为**逐字节一致**，否则会打挂现有的本机开发与离线使用。

### 2.2 前缀为什么写死 `/8000`

ChatTool 侧的部署前缀由环境变量 `CHATTOOL_PREFIX` 决定（见 ChatTools 仓库
`doc/feat/deploy-8000.md`），目前固定为 `/8000`。

draw 侧无法在运行时读到这个变量，只能约定。为把耦合集中到一处，
把前缀抽成常量 `CHATTOOL_PREFIX = '/8000'`，将来换路径只改这一行。

不选「draw 也做运行时配置 UI」的理由：多一个设置项、多一处持久化、多一类
「配错导致连不上」的故障；而这是**单用户自建部署**，改一行常量足够。

### 2.3 抽成可注入的纯函数

不能直接读全局 `location`——`tests/test_chattool.mjs` 是 `node --test` 跑的纯逻辑
测试，`location` 不存在。故：

```js
export function resolveChatToolUrl(loc) {
  // loc: { protocol, origin, hostname }
  ...
}
export const CHATTOOL_DRAW_URL = resolveChatToolUrl(
  typeof location !== 'undefined' ? location : null);
```

测试可注入任意 `loc`，覆盖全部形态，无需 mock 全局。

### 2.4 判定规则

```
1. 没有 loc / loc.protocol 不是 http: 或 https: → 回退本机（覆盖 file://）
2. hostname 是 localhost / 127.0.0.1 / ::1 → 本机开发，回退本机地址
   （保留原语义：draw 在本地跑时 ChatTool 也在本地 8765）
3. 其它 → loc.origin + PREFIX + '/api/favorites/draw'
```

第 2 条是必要的：否则本机开发时 `http://localhost:8090` 会去连
`http://localhost:8090/8000/api/favorites/draw`——那个端口的 server.js 没有这条路由。

### 2.5 Basic Auth 凭据

同源部署下 ChatTool 受 Nginx Basic Auth 保护。浏览器对 `fetch` 默认
`credentials: 'same-origin'`，同源请求通常会自动带上已认证状态；但显式写
`credentials: 'include'` 语义更清楚，也覆盖「draw 与 ChatTool 不同源但同站」
的将来变体。**代价为 0**（同源时两者等价），故直接写死。

不改成 `credentials: 'omit'`，否则认证状态丢失 → 401。

## 3. 交付物

| 文件 | 改动 |
|---|---|
| `js/chattool.js` | 加 `CHATTOOL_PREFIX`、`resolveChatToolUrl(loc)`；`CHATTOOL_DRAW_URL` 改为推导 |
| `js/favorites.js` | `importFromChatTool` 的 `fetch` 加 `credentials: 'include'` |
| `tests/test_chattool.mjs` | 加 `resolveChatToolUrl` 用例矩阵；改原硬编码断言 |
| `doc/feat/chattool-url-origin.md` | 本文档 |

**不做**：draw 侧的路径可配置 UI（见 2.2）；不改 ChatTool 的 `/8000` 前缀。

## 4. 验收

| # | 场景 | 期望 |
|---|---|---|
| 1 | `resolveChatToolUrl({protocol:'https:',origin:'https://ex.com',hostname:'ex.com'})` | `https://ex.com/8000/api/favorites/draw` |
| 2 | `hostname:'localhost'` | `http://127.0.0.1:8765/api/favorites/draw` |
| 3 | `hostname:'127.0.0.1'` | 同上 |
| 4 | `protocol:'file:'` | 同上 |
| 5 | `loc` 为 `null` | 同上（模块加载不崩） |
| 6 | 服务器上打开 draw，点「📥 从 ChatTool 拉取」 | 成功拉到卡片 |
| 7 | 本机 `node server.js` + ChatTool 8765 | 与改动前一致 |
| 8 | `node --test tests/test_chattool.mjs` | 全绿，且无 `location is not defined` |

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 服务器路径不是 `/8000` | 前缀抽成常量，改一行 |
| `credentials:'include'` 触发 CORS 更严校验 | 同源不涉及 CORS；跨源时 ChatTool 已配 `CHATTOOL_CORS_ORIGINS` |
| 本机开发被误判成服务器 | 验收 #2/#3/#7 直接覆盖 |

---

## 6. 实现与校验结果

### 6.1 实测

`resolveChatToolUrl` 各分支（`node --test` 注入 loc）：

| loc | 返回 |
|---|---|
| `{protocol:'https:',origin:'https://ex.com',hostname:'ex.com'}` | `https://ex.com/8000/api/favorites/draw` |
| `{protocol:'http:',origin:'http://1.2.3.4:8080',hostname:'1.2.3.4'}` | `http://1.2.3.4:8080/8000/api/favorites/draw` |
| `hostname: 'localhost' / '127.0.0.1' / '::1'` | `http://127.0.0.1:8765/api/favorites/draw` |
| `{protocol:'file:'}` / `null` / `undefined` | `http://127.0.0.1:8765/api/favorites/draw` |
| `{protocol:'http:',origin:'',hostname:'ex.com'}` | `http://127.0.0.1:8765/api/favorites/draw`（防 `undefined/8000`） |

单文件产物 `MutipleChat.html` 重新构建后（279.7 KB），抽出打包代码在 node 里跑同样用例，
结果与上表一致——`file://` 打开时仍回退本机地址，**离线行为零变化**。

### 6.2 测试

- `tests/test_chattool.mjs`：31 项通过（原 25 项 + 新增 6 项：4 组地址矩阵、
  1 项前缀常量、1 项 `credentials` 静态断言）。
- 其余 6 个纯逻辑套件（edgeops/geom/md/nodestyles/zone/ui_assets）全绿，无回归。

### 6.3 一次「不能删断言」的判断

原测试写的是：

```js
assert.match(CHATTOOL_DRAW_URL, /^http:\/\/127\.0\.0\.1:8765\/api\/favorites\/draw$/);
```

改成推导后该断言在 node 下仍能通过（无 location → 回退本机），但它锁的语义
已经变了：从「地址恒为本机」变成「无 location 时回退本机」。
若只是让它绿，会掩盖「服务器上到底连哪」这一核心行为。
故改成 6 项矩阵测试，把这个常量真正要保证的东西（**按形态分支**）表达出来。

### 6.4 遗留

- 部署路径若不是 `/8000`，改 `js/chattool.js::CHATTOOL_PREFIX` 一行并重跑 `node build.js`。
- `server.js` 的 `/proxy` 仍为开放代理（`Access-Control-Allow-Origin: *`，无鉴权/限流），
  与本次无关，另行评估。
