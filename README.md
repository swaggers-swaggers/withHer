<p align="center"><img src="assets/studydesk-icon.png" width="88" alt="StudyDesk 图标"></p>

# withHer · StudyDesk

一张安静的学习桌，和一个有自己小日子的 AI 伙伴。

StudyDesk 将待办、45/15 专注计时、随手记、学习统计和日历放在一个本地桌面应用里。大肥鱼是可选的 DeepSeek 聊天伙伴：记住有依据的用户陈述，形成独立的感受，也会延续自己的虚构生活，在合适的时候与你分享。

**2.3 · Windows / Linux · Electron + React + TypeScript · 本地 SQLite · 聊天可选**

[Windows 安装与打包](docs/WINDOWS.md) · [隐私与数据流](docs/PRIVACY.md) · [架构说明](docs/ARCHITECTURE.md) · [Windows 构建](https://github.com/swaggers-swaggers/withHer/actions/workflows/build.yml)

## 能做什么

| 学习桌 | 大肥鱼 |
| --- | --- |
| 待办、标签、到时提醒 | 一段连续的聊天，可检索更早的内容 |
| 45 分钟学习 / 15 分钟休息 | 最近最多 200 条完整消息作为聊天上下文 |
| 学习时长补录、随手记 | 短期事项、有原文依据的长期事实记忆 |
| 日 / 周 / 月统计、日历回顾 | 独立的感情、动机与概率触发的幻想 |
| 本地备份、JSON 导出、系统托盘 | 待说片段、模拟生活、未来联系计划与空闲主动联系 |

2.3 新增：

- **想说但没说的话**：独立保存角色待说片段；模型可自行选择查阅、修改、移除，不自动把全部片段塞进每轮上下文。
- **更慢的回复节奏**：默认约 75% 的普通回复额外等待 15 秒～3 分钟，其余正常发送；等待期间不持续显示“正在输入”。新消息会取消过时的待发回复。
- **概率幻想**：默认每轮 25% 概率生成幻想，只作为可选对话上下文，不再要求临时动机。
- **主动计划**：模型可安排未来 1 分钟～7 天内的联系意图；到期后根据最新对话决定发送、改期或静默取消。应用退出时不会发消息，过期计划不会集中补发。

专注、锁屏、休眠或长时间离开电脑时，主动联系会受到抑制。关闭窗口后程序保留在托盘中；要停止全部后台活动，请从托盘菜单选择“退出应用”。

## 快速开始

需要 **Node.js 22.18 或以上的 22.x 版本、npm 和 Git**。使用 Windows 10/11 x64，或有图形桌面的 Linux。建议使用 npm，保留仓库的 `package-lock.json`。

```bash
git clone https://github.com/swaggers-swaggers/withHer.git
cd withHer
npm ci
npm run build
npm start
```

Windows PowerShell 可以直接执行以上命令，不需要 WSL、Python、Docker 或数据库服务。Linux 首次启动可能需要配置 Chromium sandbox，见下文。

`npm start` 打开 Electron 桌面程序。`npm run dev` 只提供前端开发服务，单独在浏览器中打开不具备桌面数据接口。

### Windows 安装包

在 Windows 的项目目录执行：

```powershell
npm run package:win
```

输出到 `release/`：

- `StudyDesk-2.3.0-x64-nsis.exe`：安装程序，支持选择目录、桌面和开始菜单快捷方式。
- `StudyDesk-2.3.0-x64-portable.exe`：免安装程序。应用数据仍保存在当前 Windows 用户的数据目录。

也可以打开仓库的 **Actions → Build and check**，从成功的 Windows 任务下载 `StudyDesk-Windows-x64` 构建产物。构建不需要你的 DeepSeek 密钥，不会调用真实模型。当前构建未配置代码签名证书。

完整步骤、数据位置、常见问题与验收清单见 [Windows 部署说明](docs/WINDOWS.md)。

### Linux 打包与启动

```bash
npm run pack
npm run package:deb
sudo apt install ./release/StudyDesk-2.3.0-amd64.deb
```

`pack` 会准备 Chromium sandbox；本机已有配置正确的 Chrome helper 时可复用。若提示缺少启动组件，先执行 `npx electron-builder --linux dir --publish never` 生成目录，再运行 `npm run package:deb` 并安装 deb，之后从应用列表打开。不要通过关闭 sandbox 来解决启动问题。

源码目录可用 `npm run install:local` 创建 Linux 桌面入口；该命令依赖 GNOME/XDG 桌面工具，Windows 使用安装包自动生成的快捷方式。

## 启用聊天

1. 打开大肥鱼聊天区域的设置。
2. 填入**你自己的** DeepSeek API 密钥；确认账号可使用的模型名称，保存设置。
3. 点击“启用聊天”。不配置密钥也可以使用待办、计时、笔记和统计。

默认模型名称保存在 `companion/engine-settings.json`，当前为 `deepseek-flash`。模型、余额和搜索/网页读取接口的可用性取决于服务商与账号；本仓库不附带任何密钥，也不承诺特定账号可用全部联网功能。

密钥通过 Electron `safeStorage` 和操作系统提供的能力加密保存。加密不可用时只在本次运行中保留；也支持通过进程环境变量 `DEEPSEEK_API_KEY` 提供密钥，避免将它写进源码或配置模板。

**本地保存不等于聊天完全离线。** 启用 AI 后，相关对话、记忆、笔记/待办和学习概览会发送至 DeepSeek，后台整理、联网和模拟生活也可能产生 API 请求与费用。完整数据流见 [隐私说明](docs/PRIVACY.md)。

## 开发与检查

```bash
npm run test:portable
npm run build
npm run check:privacy
```

`test:portable` 使用临时目录、合成数据与模拟服务，覆盖学习记录、事实记忆、工具调用、主动联系和聊天显示，不读取个人配置，也不消耗真实 API 额度。

打包之后运行 `npm run test:smoke`，验证空白数据启动、隔离的渲染进程、待办保存和退出。再运行 `npm run test:packaged-chat`，用模拟服务检查真实窗口中的延迟发送、待说片段、定时联系和取消。Windows 工作流会执行安装包构建及这个启动检查；安装向导、普通桌面快捷方式、系统通知与锁屏行为仍需按部署文档在真实 Windows 桌面验收。

## 项目结构

```text
app/                      React 页面、学习统计、聊天界面
electron/main.cjs         桌面窗口、托盘、提醒与 IPC
electron/store.cjs        学习记录和计时持久化
electron/dafeyu-engine.cjs 聊天引擎和任务调度
electron/agent/           事实、感受、待说片段、联系计划、延迟发送、幻想与模拟生活
companion/               通用默认人设、提示词和参数
scripts/                 启动、跨平台打包、发布隐私检查
tests/                   合成数据测试与空白配置启动检查
docs/                    公开的架构、隐私、Windows 和资源说明
```

默认提示词只在新数据目录缺失相应文件时复制，不覆盖已有用户的自定义内容。修改提示词的方法见 [架构说明](docs/ARCHITECTURE.md)。

## 公开仓库的边界

仓库只发布程序、通用默认提示词、资源和合成测试，不附带作者的记忆库、聊天、日记、学习记录、个人配置、密钥、调用记录或备份。发布前请运行 `npm run check:privacy`；对已暂存的文件还可运行 `node scripts/check-privacy.cjs --staged`。模式扫描只是检查的一部分，新增示例、截图和文档仍需人工检查。

开发依赖及图像说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [资源说明](docs/ASSETS.md)。本仓库目前未选择项目开源许可证；公开可见不代表授予任意再分发许可。
