# Windows EXE 打包说明

## 功能说明
- 启动 EXE 后会自动拉起后端服务。
- 后端会直接托管 `web/dist` 前端页面。
- 服务健康检查通过后，自动打开默认浏览器访问 `http://127.0.0.1:8787`。

## 前置条件
- Windows x64
- Node.js 18+
- `server/.env` 已配置（尤其是邮件 SMTP 配置）

## 打包步骤
1. 安装依赖
```bash
npm install
```

2. 构建并打包 EXE
```bash
npm run build:exe
```

3. 产物目录
- `release/AI_Auto_1688_0.1.0.exe`

## 开发调试
- 直接启动桌面壳（不打包）：
```bash
npm run start:desktop
```

## 说明
- 后端数据目录在桌面壳模式下由 `DATA_DIR` 指向用户目录（Electron `userData/data`）。
- 如果 `web/dist` 不存在，后端会仅提供 API，不会打开前端页面。
