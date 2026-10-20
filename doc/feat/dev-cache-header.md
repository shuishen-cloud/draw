# 开发服务器补缓存头（dev-cache-header）

## 1. 问题

`server.js` 提供静态文件时只设 `Content-Type`：

```js
res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
```

实测响应头：

```
HTTP/1.1 200 OK
Content-Type: text/javascript; charset=utf-8
Date: Tue, 20 Oct 2026 13:05:43 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

**`Cache-Control` / `ETag` / `Last-Modified` 一个都没有。**

### 后果

按 HTTP 规范，响应既无 `Cache-Control` 也无 `Expires`/`ETag`/`Last-Modified` 时，浏览器采用**启发式缓存**：以 `Date` 为基准自行估算有效期（通常是 `(Date - Last-Modified) * 0.1`，但无 `Last-Modified` 时行为不确定，Chrome 往往缓存数分钟）。

实际表现：

- 改完 `js/*.js`、`styles.css`，普通刷新（F5）拿到的仍是旧文件；
- 必须 `Ctrl + Shift + R`（清空缓存）才能看到改动；
- 更糟的是——服务端逻辑本身没问题，**看起来像"功能没生效"**，导致排查方向错误。

本项目已多次因此误判（如 `touch-link`、`node-scroll`、`md-render` 阶段的"刷新后没效果"）。

## 2. 设计

这是**本地开发服务器**（`node server.js`，端口 8090，仅本机使用），正确策略是**明确禁止缓存**：

```
Cache-Control: no-store, must-revalidate
Pragma: no-cache          # HTTP/1.0 老代理兜底
Expires: 0                # 同上
```

### 应用范围

| 响应 | 是否加 | 理由 |
|---|---|---|
| 静态文件 200 | ✅ | 开发时永远要最新 |
| 404 | ✅ | 错误页被缓存会导致"修好了还报 404" |
| `/proxy` 数据接口 | ✅ | 数据接口本就不该被缓存（当前也未设，一并补） |
| `OPTIONS` 预检 | 不需要 | 204 空响应 |

### 不做的事

- **不加 `ETag` / `Last-Modified`**：有 `no-store` 后条件请求没有意义，加了反而增加代码复杂度。
- **不改 MIME 表**：与缓存无关。
- **不影响生产**：容器部署走 nginx（`deploy-access-gate` feat 的配置），`server.js` 只在本地开发用。文档里写清这一点，避免误以为生产也不缓存。

## 3. API / 数据 / 日志 / 兜底

| 项 | 内容 |
|---|---|
| API | 无新增；静态资源与 `/proxy` 响应头变化 |
| 数据模型 | 无变化 |
| 日志 | 无新增 |
| 兜底 | 若某些老代理只认 `Pragma`/`Expires`，两者都给了；不影响文件内容返回 |

## 4. 影响面

- `server.js`：静态文件响应、404 响应、`/proxy` 响应
- **不改**：`index.html`、`js/*`、`styles.css`、构建产物、部署配置

## 5. 校验

### 5.1 自动化（`tests/e2e_dev_cache.cjs`）

1. `GET /js/main.js` 响应头含 `cache-control: no-store`
2. 同时含 `must-revalidate`
3. 含 `pragma: no-cache` 与 `expires: 0`
4. `GET /`（index.html）同样带 `no-store`
5. `GET /styles.css` 同样带 `no-store`
6. 404 路径同样带 `no-store`
7. 两次连续请求返回内容一致（服务器不缓存内容，直接读盘）
8. **内容即时性**：临时改写 `js/md.js` 的一个可辨识字符串 → 立即请求 → 返回新内容；测试后还原

> 测试会启动/复用 8090 服务。若服务未运行，测试自行 `spawn` 一个临时端口（如 8099）以免干扰开发中的实例。

### 5.2 手工

- 改一行 `styles.css` → 普通 F5 → 立即生效，无需强刷

## 6. 实现与校验结果

（close 阶段回填）
