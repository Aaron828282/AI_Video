# 1688 商品抓取 MVP（Extension + Server + Web）

本仓库实现了 PRD 的 Phase 1 主链路：
- Chrome/Edge 插件 Side Panel 接收拖拽图片
- 在 1688 商品页执行抓取（商品信息、图片、SKU、价格阶梯、时间戳）
- 通过 REST API 上传后端并持久化
- 商品信息管理网站展示、排序、视图切换、单删/批删

## 目录结构

```text
.
├─ extension/   # Chrome MV3 插件
├─ server/      # Node.js + Express API
└─ web/         # React + TypeScript 管理端
```

## 快速启动

### 1) 启动后端 API

```bash
npm install
npm run dev:server
```

默认地址：`http://localhost:8787`

健康检查：`GET /api/health`

### 2) 启动网站

```bash
npm run dev:web
```

默认地址（Vite）：`http://localhost:5173`

可通过环境变量修改 API 地址：
- `VITE_API_BASE=http://localhost:8787`

### 3) 加载插件

1. 打开 Chrome `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录
5. 点击插件图标打开右侧 Side Panel

## 插件能力（MVP）

- Side Panel 悬浮标签折叠/展开
- 拖拽进入高亮提示
- 仅通过拖拽触发抓取
- 抓取状态反馈：悬停、抓取中、成功、失败（含重试）
- 本地缓存最近 20 条（`chrome.storage.local`）
- 上传失败时保留缓存并可重试

## API 说明

- `POST /api/products`：上传单条商品记录
- `GET /api/products?sortBy=capturedAt|priceMin&order=desc|asc`：查询列表
- `DELETE /api/products/:recordId`：删除单条
- `POST /api/products/batch-delete`：批量删除

数据存储文件：`server/data/products.json`

## 权限与 Manifest

插件使用 Manifest V3，核心权限：
- `sidePanel`
- `activeTab`
- `scripting`
- `storage`
- `tabs`
- `host_permissions`: `*.1688.com` + 本地 API 地址

## 风险说明

1688 页面可能存在动态渲染、DOM 变更、反自动化策略，当前抓取逻辑为「页面 DOM 启发式解析」。上线前建议补充：
- 更细的页面选择器映射
- 失败回退策略与采集质量监控
- 合规评估（目标站点服务条款与数据使用边界）

