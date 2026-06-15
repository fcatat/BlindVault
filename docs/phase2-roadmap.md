# BlindVault Phase 2 路线图 — 现代 Agent 能力

> 背景：MVP（#13–#22）已完成并通过安全复审——两个拦截点（出站脱敏 + 执行注入/审批）全链路验证。
> Phase 2 目标：把"现代 agent 能力"（计划、自愈重试、子 agent、定时任务）补上**并在 UI 露出**，
> 让产品用起来像 Claude Code 那样"会计划、会重试、会等确认、能跑定时任务"。

## 能力盘点（按来源分三类）

**(a) 框架自带、已在用** —— 无需额外做：
- 多轮自动工具调用（agent 循环）、流式、等待人工（interrupt 审批）、断点续跑（Redis checkpointer）、多轮记忆（thread）。

**(b) 框架能给，但要主动加** —— Phase 2 主战场：
- 自愈重试（命令失败→诊断→换方案）：旧版 graph.py 写过，移植 + 接 create_agent 的循环。
- 计划/任务拆解（todo、plan）：deepagents 或 planning middleware。
- 子 agent / 委派：handoffs / 多 agent。

**(c) 不归 agent 框架管** —— 独立组件：
- 定时/周期任务：旧版 scheduler.py，单独接回，跟 LangGraph 无关。

## 优先级（性价比 + 可见度）

### Batch 1（先做：高性价比 + 看得见）
- **#24 自愈重试移植** 🟢 —— 性价比最高。create_agent 的循环本就让模型看到工具报错后自行重试；只需把旧版"诊断增强"（command not found→提示装依赖 等）作为执行器/中间件的**输出后处理**补回（务必在脱敏之后），再调系统提示词。低工作量、强autonomy观感。
- **#25 任务计划/拆解 + UI 露出** 🟢 —— "会计划"的核心观感。用 deepagents 或 planning middleware 让 agent 先出计划再执行，并在 demo 页把计划步骤列出来。
- **#26 执行过程实时 UI 露出** 🟢 —— 你之前"看不到"的直接解药。用已有的 `astream_events` 把"思考/工具调用/重试/计划步骤"流式推到 demo 页，让一切可见。

### Batch 2（后做）
- **#27 子 agent / 委派** 🟢（注意：每个子 agent 必须套同一套安全 middleware，否则绕过拦截点）。
- **#28 接回定时/周期任务 scheduler** 🔴（涉及 resolve_secret 在后台解析凭证，安全敏感，须强模型复审）。

## 原则不变
- 安全关键代码（脱敏 / resolve / 识别规则）任何改动仍须强模型复审。
- 自愈的诊断增强、子 agent 的工具、scheduler 的凭证解析——这些都触碰安全边界，标注清楚归属。
- 每个功能"做了"还要"在 UI 看得见"才算完成。
