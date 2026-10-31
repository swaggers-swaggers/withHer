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
| `agent/motivation.cjs` | 基础/自定义动机（与幻想独立） |
| `agent/unsaid.cjs` | 角色待说片段，模型按需查阅/改写/移除 |
| `agent/imagination.cjs` | 按概率生成可选幻想上下文，不生成临时动机 |
| `agent/contact-plans.cjs` | 持久化联系意图、到期认领、改期/取消、重试与过期 |
| `agent/reply-plan.cjs` | 校验模型自主选择的沉默/发送、气泡边界和时间间隔 |
| `agent/delivery.cjs` | 持久化逐气泡安排、实际送达回执、过期与防重 |
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

## 2.3 对话行为

待说片段保存在独立的 `metadata.unsaid`，以稳定 key 更新，最多 24 条，每条最多 2000 字。初始对话上下文只给数量与版本；模型自行调用 `unsaid_read` / `unsaid_update`。它是角色可以表达的片段，不是模型推理、用户事实或必须发送的承诺，界面不会展示其内容。

`metadata.contact_plans` 保存独立联系计划，最多 12 个有效计划，保留最近 100 个终态。`contact_plan_read/update` 支持读取、增加、改期、取消。时间为未来 1 分钟至 7 天；ISO 时间必须带时区，也支持相对分钟数。同一意图复用 key，避免重复。

到期计划先持久化认领，再进入同一消息队列，用最新对话重新生成；模型可通过 `contact_plan_decide` 选择发送、静默取消或改期。专注、锁屏、闲置、输入、手动暂停及最近联系间隔会推迟执行；失败默认 5 分钟后重试，到期后默认 3 小时内仍可顺延，超过有效期则放弃。引擎约每 30 秒检查一次，到期是触发时刻，不保证精确到秒送达；前一条回复正在处理时会排队。计划只在应用运行并启用聊天时执行，不是操作系统闹钟。

## 2.4 逐气泡发送与沉默

模型在每次对话的最终输出中给出一个严格的发送安排：

```json
{"decision":"send","bubbles":[{"text":"诶！","after_ms":400},{"text":"下一句\n仍在同一气泡","after_ms":1700}]}
```

也可以返回 `{"decision":"silent","bubbles":[]}`。silent是有效的完整决定，不是失败；可选 `resume_after_ms` 表示一段自主安静时间（最长7天），期间暂缓主动联系，用户发来新话题后重新判断。

气泡数量、正文、断句、首条等待与后续每个间隔均由模型选择；不使用随机等待，不按换行、标点或字符数重新切分。第一条 `after_ms` 相对安排完成，允许0；后续相对上一条**实际送达**，必须大于0。模型可选择密集短消息、一个长气泡、几分钟后再说或不回复。`kind=code`保留代码缩进与换行。

程序校验安排后，在一个事务中保存有效的内部状态与待发安排。待说片段、感情、近期事项与未来意图不等于已经说过；有效沉默也能保留这些内部修改。失败或无效协议不会提交工具修改。`life_mark_shared`仍须等待整组消息实际发完，静默或中断不能标为已经分享。

`delivery_outbox`保存本轮安排，`delivery_bubbles`逐条保存正文、模型指定间隔、到期时间、状态和实际消息编号。定时器到期只送达一个气泡，消息插入和发送回执在同一SQLite事务提交。只有实际送达的气泡才进入 `messages` 和界面；不会提前将整组内容载入DOM再隐藏。气泡通过明确的 `model_bubble` 标记保留原边界，旧历史保持原来的展示方式。

发送队列与模型生成队列分离。等待时不持续显示“正在输入”，生活与记忆整理可继续；同一段待发对话未结束时，其他主动话题不会机械插入。用户插话会取消未送出尾巴、保留已送前缀，并按最新真实对话重新调用模型。新用户输入也可中断尚未完成的旧生成，不强制每条输入对应一条回复。

退出时保留逐气泡进度，重启后从下一条继续，不重新生成已安排的正文。迟到恢复时，后续间隔从上一条实际送达重算，不把多个过期到点气泡瞬间倾倒出来。超过有效期取消；切换模型、移除凭据或手动暂停会取消待发部分。2.3旧版整段待发草稿在升级时取消，不假装它是模型自行规划的气泡；已发送的历史不变。

当前采用“模型一次规划一组，程序逐条执行”，并非每个气泡前都再次调用模型。新输入会触发重新规划。逐气泡规则文件是 `bubble-policy-v24.md`，加载在系统提示词末尾，替代旧文件中必须回复、final直接输出自然文字和随机延迟的旧约定；保留已有自定义人设。

幻想默认每轮 25% 概率触发，使用 `imagination-context.md`，仅返回 `fantasy`，不要求或使用 `motive`；基础/自定义动机仍独立选择。幻想失败不会阻断普通对话，不写入用户事实。

新版本增加 `conversation-v23.md` 与 `imagination-context.md`，启动时只补齐缺失文件，保留已有自定义人设。旧 `imagination.md` 不再是幻想生成入口；附加行为提示词明确替代旧回复提示词中的临时动机约定。

### 可调整参数

| 参数 | 默认值 | 作用 |
| --- | --- | --- |
| `chat_temperature` | 0.7 | 聊天请求的温度参数，覆盖所有聊天工具轮次 |
| `chat_thinking` | false | 聊天关闭思考，使temperature生效；后台整理仍开启思考 |
| `reply_max_bubbles` | 64 | 每轮气泡资源上限，不是推荐数量 |
| `reply_max_characters` | 32000 | 一组正文总长度上限 |
| `reply_max_schedule_ms` | 86400000 | 一组累计等待上限，24小时 |
| `delivery_max_age_ms` | 21600000 | 待发安排基础有效期，6小时 |
| `delivery_send_grace_ms` | 10800000 | 晚于基础有效期的模型安排在最后计划时间后再保留3小时 |
| `fantasy_probability` | 0.25 | 每轮幻想上下文的概率，独立于发送节奏 |
| `contact_plan_retry_ms` | 300000 | 未来联系计划失败/中断后的重试间隔 |
| `contact_plan_min_gap_ms` | 120000 | 未来联系计划与最近消息的最低间隔 |

旧 `reply_delay_probability`、`reply_delay_min_ms`、`reply_delay_max_ms` 在升级时移除。当前用户的 `dafeyu-config.json`、待说片段、计划和待发气泡都是私人数据，不应上传 GitHub。

DeepSeek 思考模式会忽略 temperature，所以聊天请求使用 `thinking.type=disabled`，且不发送 `reasoning_effort`；后台 `object()` 请求仍按原来的思考模式执行。参考：[DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。
