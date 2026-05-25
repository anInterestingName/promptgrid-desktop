# PromptGrid Desktop

[English](./README.md)

PromptGrid Desktop 是一个本地优先的 AI 视觉方向探索桌面工作台。它把一个创意想法拆成一组可编辑的提示词方向，再用网格方式帮助用户比较、重生成、扩展和导出图片结果。

## 当前状态

这个仓库目前是一个可运行的 Mock 原型，技术栈为 Tauri v2、React、TypeScript 和 Vite。

已完成：

- 基于 Tauri 的桌面应用外壳。
- 三栏式视觉探索工作台。
- 原始提示词输入和 9 个可编辑提示词变体。
- Mock 版 3x3 图片生成网格。
- 单元格任务状态、预览弹窗、重新生成和扩展操作。
- 中英文界面切换。
- 可切换的色彩主题系统。

尚未完成：

- 真实 AI 服务调用。
- SQLite 本地持久化。
- 项目专属的本地图片存储。
- 真实的单图导出和网格图导出。

## 产品想法

第一版产品循环刻意保持简单：

```text
输入一个想法
-> 拆成 9 个提示词方向
-> 生成 3x3 图片网格
-> 对比结果
-> 重生成较弱单元格，或从较强单元格继续扩展
-> 在本地保存/导出结果
```

PromptGrid 不只是批量图片生成工具。它更核心的价值是：AI 辅助提示词分支、网格优先的视觉比较、单元格级别迭代，以及用户对本地项目历史和素材资产的掌控。

## Phase 1 原则

- 只做桌面端。
- 数据本地优先。
- 不做自定义云后端。
- 不做登录和账号系统。
- 不做云同步。
- 不做小程序或移动端。
- 用户自行配置 AI API Key。
- 项目、图片、提示词、任务和导出文件都保存在用户自己的机器上。

## 技术栈

```text
桌面外壳：Tauri v2
前端：React + TypeScript + Vite
状态管理：Zustand
UI 基础组件：Radix UI
图标：lucide-react
本地命令层：Rust Tauri commands
计划数据库：SQLite
计划存储：本地文件系统项目目录
计划服务商：外部文本 AI 和图片 AI API
```

## 环境要求

仅开发浏览器版前端需要：

- 与 Vite 7 兼容的 Node.js。
- npm。

运行桌面应用还需要：

- Rust/Cargo。
- 目标系统对应的 Tauri v2 依赖。
- Windows 上需要 WebView2 和 MSVC Build Tools。

## 快速开始

安装依赖：

```bash
npm install
```

在浏览器中启动 Web UI：

```bash
npm run dev
```

启动桌面应用：

```bash
npm run tauri:dev
```

桌面端开发服务使用独立端口 `http://127.0.0.1:1421`，可以和浏览器 Web UI 同时运行。

构建前端：

```bash
npm run build
```

构建桌面应用安装包：

```bash
npm run tauri:build
```

## 脚本

```text
npm run dev          在 http://127.0.0.1:1420 启动 Vite Web UI
npm run dev:tauri-ui 在 http://127.0.0.1:1421 启动 Tauri 使用的 Vite UI
npm run build        类型检查并构建前端
npm run preview      预览前端生产构建结果
npm run tauri        运行 Tauri CLI
npm run tauri:dev    以开发模式启动 Tauri 桌面应用
npm run tauri:build  构建 Tauri 桌面应用安装包
npm run lint         运行 ESLint
npm run format       使用 Prettier 格式化项目文件
```

## 项目结构

```text
.
|-- src/                  React 应用源码
|   |-- components/        工作台、侧边栏、提示词面板和顶部栏
|   |-- data/              Mock 项目数据
|   |-- state/             Zustand store
|   `-- styles/            应用样式
|-- src-tauri/            Tauri v2 Rust 桌面外壳
|   |-- capabilities/      Tauri capability 配置
|   |-- icons/             桌面打包所需应用图标
|   `-- src/               Rust 入口和命令
|-- docs/                 产品和实现规划文档
`-- dist/                 前端生产构建输出
```

## 文档

- [Agent Guide](./agent.md)
- [Product Brief](./docs/product-brief.md)
- [Technical Plan](./docs/technical-plan.md)
- [Roadmap](./docs/roadmap.md)
- [Implementation Tasks](./docs/implementation-tasks.md)
- [Decision Log](./docs/decision-log.md)

更早期的想法阶段规划归档在：

```text
../../ideas/ai-image-grid-desktop-app/
```

## 路线图

下一阶段重点：

- 增加基于 SQLite 的本地持久化。
- 将生成图片保存到项目专属文件夹。
- 为文本 AI 和图片 AI 服务增加 provider 边界。
- 增加安全的 API Key 设置。
- 实现真实的重试、重生成、扩展和导出流程。
- 补充 Windows 和 macOS 打包说明。

## 许可证

见 [LICENSE](./LICENSE)。
