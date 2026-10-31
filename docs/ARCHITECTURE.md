# 架构与默认提示词

前端使用 React + TypeScript + Vite；Electron 主进程管理窗口、托盘、提醒、SQLite、API 和调度。预加载层提供有限的 IPC 接口，渲染进程使用 context isolation 与 sandbox，不启用 Node integration。

## 学习记录

`electron/store.cjs` 保存待办、标签、随手记、学习时段和每日回顾。`app/analytics.ts` 根据本地时段汇总统计。计时、学习补录与聊天相互独立。

## 大肥鱼引擎

| 模块 | 职责 |
| --- | --- |
| `dafeyu-engine.cjs` | 消息队列、对话请求、工具循环、启动停止与调度 |
| `agent/store.cjs` | SQLite、原始消息、事实、关系版本和生活记录 |
| `agent/memory.cjs` | 根据真实用户消息和逐字证据整理事实 |
| `agent/short-term.cjs` | 带来源、有效期的近期事项 |
| `agent/relationship.cjs` | 独立的角色感受与看法，不回写成用户事实 |
| `agent/motivation.cjs` | 基础/自定义动机与临时想象 |
| `agent/life.cjs` | 虚构活动的计划、等待、完成、分享与日记 |
| `agent/web.cjs` / `news.cjs` | 搜索、网页读取、带来源时间的在线素材 |
| `agent/study.cjs` | 学习概览及待办/笔记检索 |
| `agent/scheduler.cjs` | 主动联系的时机和抑制条件 |
| `agent/deepseek.cjs` | API 请求、错误隐藏、可见回复过滤 |

事实、角色感受、想象、联网材料与模拟生活分开保存。模拟生活是双方知情的角色创作，不是现实中的经历，也不应成为用户事实。角色生活只在应用运行时推进，不补造关闭期间发生过的现实活动。

界面只展示最终回复，工具中间内容与推理字段不作为聊天正文。最近最多 200 条原始消息按数量保留；超过模型上下文上限时显示失败，不自动缩短历史。

## 修改默认提示词

仓库的 `companion/persona.md` 和 `companion/prompts-v2/*.md` 是通用发布默认值。应用首次启动时将缺失文件复制到用户数据目录中的 `companion-prompts/`，后续调用从该位置重新读取。

要修改当前电脑上的角色，请先备份用户数据，再编辑**用户数据目录**中的提示词；只修改仓库默认文件不会覆盖已有用户版本。`dafeyu-config.json` 中的 `prompt_directory` 可以指定其他本地目录。它是个人配置，不应上传。

Windows 数据目录为 `%APPDATA%\StudyDesk`；Linux 通常为 `~/.config/StudyDesk`，实际使用 Electron 的 `appData` 路径，可通过 `STUDYDESK_DATA_DIR` 为测试指定独立目录。

引擎可从同一用户数据目录中的旧版消息库导入历史。这是对用户自己本地文件的兼容路径，仓库不包含旧聊天框架、真实旧库或迁移恢复包。
