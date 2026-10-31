# Windows 部署

适用于 Windows 10/11 x64。项目使用 Electron 内置的 Node/SQLite，无需安装 Python、WSL、Docker、独立 SQLite 或向量服务。

## 从源码运行

安装 Node.js 22.x（至少 22.18）和 Git，重新打开 PowerShell：

```powershell
node --version
npm --version
git clone https://github.com/swaggers-swaggers/withHer.git
cd withHer
npm ci
npm run test:portable
npm run build
npm start
```

如果 PowerShell 的执行策略阻止 `npm.ps1`，使用 `npm.cmd ci`、`npm.cmd run build`、`npm.cmd start` 等等，不需要为此放宽系统执行策略。

不要从 Linux 复制 `node_modules`：Electron 的二进制文件与操作系统有关，Windows 上应重新执行 `npm ci`。依赖安装和首次构建/启动需要访问 npm、Electron 及 electron-builder 的官方下载资源。

## 构建安装包

```powershell
npm run package:win
npm run test:smoke
npm run test:packaged-chat
```

产物位于 `release/`：`*-nsis.exe` 是安装向导，`*-portable.exe` 是免安装程序，`win-unpacked/StudyDesk.exe` 是供开发检查的未封装目录。若只需生成未封装目录，使用 `npm run pack`。

NSIS 默认按当前用户安装，不需要为日常运行申请管理员权限；可选择安装目录并建立桌面与开始菜单入口。卸载配置不会主动删除应用数据。免安装指无需安装应用，其数据仍写入 `%APPDATA%\StudyDesk`，不随 exe 一起移动。

仓库的 `.github/workflows/build.yml` 在 Windows runner 上执行依赖安装、隐私检查、合成测试、构建、打包、空白数据启动及合成聊天检查，成功后提供 `StudyDesk-Windows-x64` artifact。也可从 Actions 手动触发。构建产物会按工作流设置到期，代码仓库不存储 exe。

项目未提供代码签名证书，系统可能提示无法识别发布者。请核对来源和构建记录；本文不要求关闭 Defender、SmartScreen 或其他系统防护。

## 首次使用与数据

启动后应看到空白待办、随手记与聊天。配置自己的 DeepSeek 密钥后才能启用 AI；学习桌功能无需密钥。

| 文件 / 目录 | 作用 |
| --- | --- |
| `%APPDATA%\StudyDesk\studydesk.sqlite` | 待办、笔记、学习时段与日历记录 |
| `%APPDATA%\StudyDesk\dafeyu.sqlite` | 聊天、事实、感受、短期事项、生活记录 |
| `%APPDATA%\StudyDesk\companion-key.enc` | 由当前系统加密的密钥 |
| `%APPDATA%\StudyDesk\dafeyu-config.json` | 当前用户的引擎参数 |
| `%APPDATA%\StudyDesk\companion-prompts` | 当前用户可编辑的提示词 |
| `%APPDATA%\StudyDesk\backups` | 本地自动备份，可能包含全部私人记录 |

开发测试可以用 `STUDYDESK_DATA_DIR` 指向独立目录；不要把它设成项目源码目录。时区默认使用运行电脑的系统时区，已有配置中的自定义时区会保留。

Windows 密钥加密绑定操作系统/用户环境，不要复制 Linux 的加密密钥文件。跨电脑搬迁时先退出应用，备份需要的数据，重新输入自己的密钥；本仓库没有自动跨系统导入向导，不会同步数据到 GitHub。

## 故障排查

| 现象 | 检查方式 |
| --- | --- |
| `node:sqlite` 或类型剥离相关错误 | 检查 Node 是 22.18 以上的 22.x，重新安装依赖 |
| 提示找不到 Electron / exe | 在当前 Windows 电脑执行 `npm ci`，不要复用 Linux 依赖 |
| 只有浏览器页面，保存无效 | 先 `npm run build`，再用 `npm start` 启动桌面应用 |
| 聊天提示模型无效或余额不足 | 检查自己账号支持的模型、密钥与余额，调整聊天设置 |
| 搜索或网页读取失败 | 服务商工具接口可能不可用；学习桌和普通聊天不等同于联网能力 |
| 关窗口后进程还在 | 正常托盘行为；右键托盘图标选择“退出应用” |
| 没收到系统通知 | 检查 Windows 通知权限、勿扰模式与应用是否已完全退出 |

## 实际桌面验收

自动启动测试不等于用户入口和系统集成验收。安装包生成后，请完成：

1. 用普通用户运行安装程序，从**桌面快捷方式**与**开始菜单**分别打开。
2. 新建待办与笔记，计时并暂停，完全退出再启动，确认记录保留。
3. 关闭窗口后从托盘恢复；从托盘退出后确认不再运行后台任务。
4. 设置一次到时提醒，检查通知；测试锁屏/睡眠后的计时暂停和恢复。
5. 输入自己的密钥并启用聊天，检查回复、暂停聊天和重启后的密钥可用性。
6. 分别运行安装版和免安装版；同一数据目录会触发单实例行为，应先退出另一实例。

参考：[electron-builder NSIS](https://www.electron.build/docs/nsis/)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
