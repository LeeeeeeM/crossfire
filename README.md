# sync-evolution-demo

前端：React + TypeScript + Vite（端口 `5174`）
后端：Bun（端口 `8787`）

## 启动

### 1) 启动后端

```bash
cd backend
bun run dev
```

接口：
- `GET /health`
- `GET /api/evolutions`
- `GET /api/evolutions/:id`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /ws/lockstep`

### 1.1) 启动 PostgreSQL（认证模块需要）

后端会读取 `DATABASE_URL`，默认值：

```bash
postgres://postgres:postgres@localhost:5432/sync_demo
```

如果你本地还没跑 PG，可用 Docker 一条命令启动：

```bash
docker run --name sync-demo-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sync_demo \
  -p 5432:5432 \
  -d postgres:16
```

若使用自定义地址，先设置环境变量再启后端：

```bash
cd backend
DATABASE_URL='postgres://user:pass@host:5432/dbname' bun run dev
```

### 2) 启动前端

```bash
cd frontend
npm install
npm run dev
```

打开：`http://localhost:5174`

## 路由

- `/doom` DOOM lockstep 可视化
- `/quake` Quake 预测+纠正可视化
- `/cnc` C&C 工程化 lockstep 可视化
- `/source` Source 快照增量同步可视化
- `/freefire` Free Fire 混合同步可视化
- `/auth` 注册/登录页（PG 账号）
- `/arena` WebSocket 帧同步对战页（登录账号即玩家身份）
