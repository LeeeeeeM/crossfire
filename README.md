# sync-evolution-demo

前端：React + TypeScript + Vite（端口 `5174`）
后端：Bun（端口 `8787`）

## 启动

### 1) 启动后端

```bash
pnpm -C backend dev
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

后端可选环境变量：

- `PORT`（默认 `8787`）
- `CORS_ORIGIN`（默认 `*`）
- `TICK_MS`、`MAX_PLAYERS`、`MOVE_PER_FRAME` 等（用于覆盖游戏参数，见 `backend/src/config/app-config.ts`）

### 2) 启动前端

```bash
pnpm install
pnpm -C frontend dev
```

打开：`http://localhost:5174`

前端可选环境变量（`.env.local`）：

```bash
VITE_API_BASE=
VITE_WS_BASE=
VITE_BACKEND_HTTP_TARGET=http://127.0.0.1:8787
VITE_BACKEND_WS_TARGET=ws://127.0.0.1:8787
```

- `VITE_API_BASE`、`VITE_WS_BASE` 用于前端请求真实地址（留空默认同源）
- `VITE_BACKEND_HTTP_TARGET`、`VITE_BACKEND_WS_TARGET` 用于本地 Vite 代理目标

## 包管理

- 工作区：`pnpm-workspace.yaml`（`frontend` + `backend`）
- 统一安装：`pnpm install`
- 根脚本：
  - `pnpm dev:frontend`
  - `pnpm dev:backend`
  - `pnpm build:frontend`
  - `pnpm typecheck:backend`

## 路由

- `/doom` DOOM lockstep 可视化
- `/quake` Quake 预测+纠正可视化
- `/cnc` C&C 工程化 lockstep 可视化
- `/source` Source 快照增量同步可视化
- `/freefire` Free Fire 混合同步可视化
- `/auth` 注册/登录页（PG 账号）
- `/lobby` WebSocket 帧同步对战页（登录账号即玩家身份）

## 文档

- `docs/gameplay.md`：玩法与**当前实现**说明（操作/物品栏/匕首与枪械弹药/自动换弹、系统提示、物资投放等；另含模式与系统草案）

## 后端架构（当前）

- `backend/src/server.ts`：应用装配入口（初始化、依赖注入、Bun.serve）
- `backend/src/controllers/http-routes.ts`：HTTP 业务路由（health/auth/evolutions）
- `backend/src/controllers/ws-upgrade.ts`：WebSocket 握手升级与 token 校验
- `backend/src/controllers/ws-handlers.ts`：WebSocket open/message/close 事件处理
- `backend/src/services/game-loop.ts`：主循环 tick（移动、战斗、掉落、广播）
- `backend/src/services/room-service.ts`：房间域模型与房间生命周期操作
- `backend/src/services/transport-service.ts`：房间/大厅消息发送与连接附着
- `backend/src/services/inventory-service.ts` / `backend/src/services/combat-service.ts` / `backend/src/utils/math-utils.ts`：规则与计算模块
- `backend/src/services/state-store.ts`：运行时状态容器（rooms/players/clients）
