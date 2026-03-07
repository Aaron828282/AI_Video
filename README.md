# AI Video (1688 商品采集与 AI 生成工作台)

一个 `extension + server + web` 的一体化项目，用于从 1688 商品页采集商品信息，并在后台完成 AI 分析、图文提示词生成、短视频脚本与视频片段生成。

## 1. 项目能力概览

- 浏览器插件拖拽采集：在 1688 商品页通过侧边栏拖拽图片触发采集。
- 商品数据管理：Web 页面查看、排序、删除、批量删除商品记录。
- 手动上传：支持上传白底图 + 商品描述进行手动建档。
- 一阶段 AI 分析：生成材质、外观、颜色、规格、卖点、采购风险等结构化结果。
- 二阶段图词生成：生成主图/详情图提示词包（含多市场语言配置）。
- 视频脚本生成：基于分析结果生成短视频脚本与镜头提示。
- 视频片段任务：调用视频接口创建任务、轮询状态、返回视频地址。
- API Key 管理：内置管理页密码登录、密钥与模型参数配置、密码重置。
- 桌面端打包：支持 Electron 打包为 Windows 可执行文件。

### 1.1 网站左侧导航说明（用户入口）

- `商品库`：查看与管理所有商品记录，执行分析、图词和短视频任务入口。
- `AI分析结果`：集中查看分析结果、图词包、短视频脚本与视频片段任务状态。
- `API Key管理`：输入管理密码后，统一配置系统使用的 API Key。
- `使用文档`：站内操作指南页，介绍功能用途与推荐使用流程（适合新用户先阅读）。
- `数据分析 / 采购清单 / 价格监控`：当前为预留入口，尚未开放。

### 1.2 推荐使用流程（5 步）

1. 先打开 `API Key管理`，输入页面密码并保存统一 API Key。
2. 打开 `商品库`，通过插件拖拽采集商品，或使用“手动创建商品链接”录入商品。
3. 在商品卡片点击“分析”，等待一阶段分析完成。
4. 在分析完成后点击“图词请求”，生成主图与详情图提示词。
5. 需要短视频时点击“短视频”，再到 `AI分析结果` 查看脚本并触发视频片段生成。

### 1.3 常见操作指引

- 删除无效数据：在 `商品库` 勾选商品后使用“批量删除”。
- 查看单个商品详情：在 `商品库` 点击商品标题或卡片，右侧会显示详情面板。
- 检查任务进度：在 `AI分析结果` 页面查看状态标签（分析 / 图词 / 短视频 / 视频片段）。

### 1.4 插件下载与安装

- 网站内入口：左侧菜单 `下载插件`，或 `使用文档` 页面内的“下载插件（ZIP）”按钮。
- 直接下载地址：`https://<你的域名>/downloads/ai-auto-1688-extension.zip`
- 默认上传地址：插件默认上传到 `https://ai-auto-1688-server-production.up.railway.app`。
- 自动修正：若本地残留了 `http://localhost:5173` / `http://127.0.0.1:5173` 等旧配置，插件会在启动时自动迁移到线上地址。
- 安装步骤：
  1. 下载 ZIP 并解压到本地目录。
  2. 打开 `chrome://extensions/`（或 Edge 扩展页）。
  3. 开启“开发者模式”。
  4. 点击“加载已解压的扩展程序”并选择解压后的 `extension` 目录。

如需切回本地开发服务，可在浏览器扩展上下文执行：

```js
chrome.storage.sync.set({ apiBase: "http://127.0.0.1:8790" });
```

## 2. 项目结构

```text
.
├─ extension/   # Chrome MV3 插件（侧边栏采集）
├─ server/      # Node.js + Express API
├─ web/         # React + TypeScript 管理端
├─ desktop/     # Electron 启动入口
├─ docs/        # 补充文档
└─ scripts/     # 调试脚本
```

## 3. 技术栈

- 前端：React 18 + TypeScript + Vite
- 后端：Node.js + Express + Sharp
- 插件：Chrome Extension Manifest V3
- 桌面：Electron

## 4. 本地开发快速启动

### 4.1 环境要求

- Node.js 18+（建议 20+）
- npm 9+
- Chrome/Edge（用于加载插件）

### 4.2 安装依赖

```bash
npm ci
```

### 4.3 配置后端环境变量

```bash
cp server/.env.example server/.env
```

至少配置你需要用到的 API Key（例如 `VECTORENGINE_API_KEY`、`COZE_API_TOKEN`、`VEO_API_KEY` 等）。

### 4.4 启动后端

```bash
npm run dev:server
```

默认地址：`http://localhost:8790`  
健康检查：`GET /api/health`

### 4.5 启动前端

```bash
npm run dev:web
```

默认地址：`http://localhost:5173`

说明：开发环境已配置 Vite 代理，前端会将 `/api`、`/static`、`/products/manual` 转发到 `127.0.0.1:8790`。

### 4.6 加载浏览器插件

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录
5. 打开插件侧边栏并在 1688 商品页测试拖拽采集

## 5. 关键环境变量说明（server/.env）

- `PORT`：服务端口（默认 `8790`）
- `PUBLIC_API_BASE_URL`：对外访问的服务根地址（生产环境必填）
- `DATA_DIR`：数据目录（未配置时默认 `server/data`；生产建议挂载持久化目录）
- `API_KEY_PAGE_DEFAULT_PASSWORD`：API Key 管理页默认密码（强烈建议设置强密码）
- `VECTORENGINE_API_KEY`：一阶段分析/二阶段提示词相关 Key
- `COZE_API_TOKEN` / `SHORT_VIDEO_*`：短视频流程相关 Key
- `VEO_API_KEY`：VEO 渲染相关 Key
- `RESET_EMAIL_SMTP_*`：密码重置邮件 SMTP 配置

详细字段见：`server/.env.example`

## 6. 数据存储与静态资源

- 商品数据：`DATA_DIR/products.json`
- API Key 设置：`DATA_DIR/api-key-settings.json`
- 图片目录：
  - `DATA_DIR/analysis-images`
  - `DATA_DIR/knowledge-base-images`
  - `DATA_DIR/manual-product-images`

后端公开静态路径仅包含上述图片目录：

- `/static/analysis-images/*`
- `/static/knowledge-base-images/*`
- `/static/manual-product-images/*`

## 7. 常用 API（节选）

- `GET /api/health`：健康检查
- `GET /api/products`：查询商品列表
- `POST /api/products`：新增/更新商品
- `POST /api/products/manual-upload`：手动上传商品
- `DELETE /api/products/:recordId`：删除单条
- `POST /api/products/batch-delete`：批量删除
- `POST /api/products/:recordId/analyze`：触发一阶段分析
- `POST /api/products/:recordId/prompt-pack`：触发图词生成
- `POST /api/products/:recordId/video-script`：触发短视频脚本生成
- `POST /api/products/:recordId/video-clips/generate`：触发视频片段生成

## 8. 插件 API 地址配置（生产环境）

插件默认请求 `http://127.0.0.1:8790`。  
如需切换为线上地址，可在插件上下文执行：

```js
chrome.storage.sync.set({ apiBase: "https://your-domain-or-railway-domain" });
```

执行后刷新插件侧边栏即可生效。

## 9. Railway（GitHub 自动部署）推荐配置

本项目推荐单服务部署（后端托管前端构建产物）：

- 仓库已提供 `railway.json`，建议优先使用仓库配置（Config as Code），避免控制台手工配置漂移。
- 若你已在 Railway 控制台配置过 Build/Start，可保持一致；以 `railway.json` 为准更易维护。

- Build Command

```bash
npm ci && npm --workspace web run build
```

- Start Command

```bash
npm --workspace server run start
```

- Healthcheck Path：`/api/health`
- 持久化卷：挂载到 `/data`
- 生产变量至少包含：
  - `NODE_ENV=production`
  - `DATA_DIR=/data`
  - `PUBLIC_API_BASE_URL=https://<your-railway-domain>`
  - 你的各类 API Key 与 SMTP 配置

## 10. Electron 打包（可选）

```bash
npm run build:exe
```

产物位于 `release/` 目录。

## 11. 常用脚本

- `npm run dev:server`：启动后端开发服务
- `npm run dev:web`：启动前端开发服务
- `npm run build:web`：构建前端
- `npm run start:server`：启动后端生产服务
- `npm run start:desktop`：启动 Electron 桌面壳
- `npm run build:exe`：构建 Windows EXE
- `node scripts/query-video-script-response.mjs --recordId <id>`：查询脚本生成结果

## 12. 当前限制与上线建议

- 目前未实现“面向最终用户”的注册/登录体系（仅 API Key 管理页有密码会话）。
- 若直接公网开放，建议至少先加网关访问控制（Basic Auth / IP 白名单）。
- 正式放量前建议补齐用户体系（注册登录、鉴权、数据隔离、限流与审计）。

## 13. 相关文档

- `docs/AI_ANALYSIS_SETUP.md`
- `docs/EXE_PACKAGING.md`
