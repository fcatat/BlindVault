# BlindVault — 安全 Agent 层产品设计

> 一句话定位：一个**独立的、自带模型访问能力**的运维 Agent 产品，让用户在不持有任何云厂商账户的前提下，使用 LLM Agent 执行运维任务，而**密码/密钥永不进入模型上下文**、**高危操作强制人工确认**。
>
> 与旧版的区别：不再自研 agent 循环。Agent 循环交给 **LangChain `create_agent`（跑在 LangGraph 1.0 durable runtime 上）**；模型访问统一经由**你自己的 LiteLLM 网关**分发；BlindVault 退化为「叠加在成熟 agent 上的安全层」。

> **框架选型最终结论（2026-06-12）：LangChain `create_agent`（LangGraph runtime）。**
> 决策路径：① 先否决 **Claude Agent SDK** —— 不开源（Anthropic 专有许可）+ 实质绑定 Claude（非 Claude 经 LiteLLM 有 `input_text` 翻译 bug）。② 再否决 **OpenAI Agents SDK** —— 虽 MIT 开源，但其非 OpenAI 路径（LiteLLM adapter）官方标注 **beta/best-effort**，对「GPT/Claude 混用、模型无关是硬需求」的本产品是不可接受的二等公民待遇。③ 选定 **LangChain `create_agent`**，三条决定性理由：
> - **模型无关是一等公民**（LangChain 厂商中立，无偏袒动机）；
> - **两个拦截点正好是内置 middleware**：`HumanInTheLoopMiddleware`（可恢复审批，需 checkpointer）+ `PIIMiddleware`（脱敏兜底）+ 自定义 `AgentMiddleware`（可逆脱敏主层，回写金库）；durable runtime 的暂停-持久化-恢复是业界最成熟；
> - 团队已熟 LangGraph，ramp 最低。
> 注：`langgraph.prebuilt.create_react_agent` 已废弃，统一用 `langchain.agents.create_agent`。OpenAI Agents SDK 仅在 API 轻量/tracing 开箱上略优，不抵上述三条。**两个拦截点架构不变。**

---

## 1. 产品定位

| 维度 | 说明 |
|---|---|
| 交付物 | 一套可私有化部署的程序（非插件）。客户安装后得到一个带 Web/CLI 入口的运维 Agent，开箱即用。 |
| 目标用户 | 没有 Claude / OpenAI 账户的运维 / SRE / 平台团队。模型访问权由产品方（你）持有并分发。 |
| 核心承诺 | ① AI 看不到任何密码（无论从输入、文件还是命令回显冒出来）；② 高危操作必须人工点确认才执行。 |
| 商业形态 | 私有化 / 一体机 / SaaS 多租户皆可。LiteLLM 的 virtual key + 预算 + 限流天然支撑多租户计费。 |

---

## 2. 整体架构

```
                          ┌──────────────────────────────────────────┐
   运维用户                │            BlindVault 应用                  │
  （无需 Claude 账户）  ──►│   Claude Agent SDK 驱动的 agent 循环         │
                          │                                            │
                          │   拦截点 B（工具执行层）：                   │
                          │   - canUseTool 回调：高危命令→人工确认       │
                          │   - secure_shell 工具：resolve 占位符为明文   │
                          │   - 输出脱敏：stdout/stderr 去除真实密码      │
                          └───────────────┬────────────────────────────┘
                                          │ Anthropic /v1/messages 格式
                                          ▼
                  ┌────────────────────────────────────────────────┐
                  │              LiteLLM 网关（你自有）               │
                  │                                                  │
                  │   拦截点 A（出站唯一咽喉）：                       │
                  │   ① 自定义 guardrail = BlindVault 脱敏器           │
                  │      → 扫描整个请求体，命中密码则存入金库、         │
                  │        替换为 {{secret:sec_xxx}}（可逆，回写金库）  │
                  │   ② Presidio guardrail = 不可逆兜底               │
                  │      → 凡是①漏掉、又像凭证的，直接 MASK 或 BLOCK    │
                  │                                                  │
                  │   持有上游模型凭证（你的 Anthropic key / 自有模型）│
                  │   virtual key / 预算 / 限流 / 审计                 │
                  └───────────────┬──────────────────────────────────┘
                                  ▼
                    Claude 模型（Anthropic / Bedrock / Vertex）
                    —— 或后续你自有的 LiteLLM 可路由的任意模型
                                  │
   ┌──────────────┐              │
   │  密码金库     │◄─────────────┘  （resolve 时由工具层访问）
   │ Redis + PG   │   AES-256-GCM；crypto.py / policy.py 9 步校验原样复用
   │ + 沙箱执行    │
   └──────────────┘
```

**关键心智：整个系统只有两个拦截点。**
- **拦截点 A**：一切流向模型的内容必须无密码 → 落在 **LiteLLM 网关**（唯一出站咽喉）。
- **拦截点 B**：执行瞬间把占位符换回真密码、并对高危操作放行/拦截 → 落在 **Agent SDK 的工具执行层**。

---

## 3. 模型访问：用户为什么不需要 Claude 账户

这是本方案相对「套 Claude Code CLI」最大的不同。

- 上游模型凭证（你的 Anthropic API key，或你自托管模型的地址）**只配置在 LiteLLM 网关里**，对终端用户完全不可见。
- 终端用户只对 **BlindVault 产品本身**认证（你自己的登录体系 / SSO）。
- LiteLLM 给每个用户/团队签发 **virtual key**，可设预算、限流、模型白名单 —— 这套就是你企业版规划里「多租户 / 配额」的现成底座。
- Agent SDK 侧通过环境变量把请求指向你的网关：把模型 base URL 指到 `https://<your-litellm>/v1`（OpenAI Agents SDK 走 `/v1/chat/completions`），API key 填用户的 virtual key。

> **承重事实（已查证）**：OpenAI Agents SDK 说 OpenAI 格式，与 LiteLLM 原生格式一致，走 `/v1/chat/completions`，guardrail 在该翻译层正常生效。（若改用 Claude Agent SDK 则须走 `/v1/messages` 并透传 `anthropic-beta`/`anthropic-version` 头，且非 Claude 模型有 `input_text` 翻译 bug —— 这也是否决它的原因之一。）

---

## 4. 两个拦截点的具体落点

### 4.1 拦截点 A —— 出站脱敏（LiteLLM 网关）

**为什么放在网关而不是应用里**：Agent SDK 自己构造并发送 HTTP 请求，应用层很难干净地改写「系统提示 + 完整历史 + 所有工具结果」这一整包。把脱敏放在网关，意味着**无论密码从哪个通道进入上下文，都必经此咽喉**，这才真正兑现 "AI Sees Nothing"。而且任何复用同一网关的客户端都自动受保护。

**两层防御（defense in depth）：**

**① 主层 — 自定义 guardrail（你写，可逆，回写金库）**
把 BlindVault 现有的 `sanitizer.py` 逻辑重写成一个 LiteLLM `CustomGuardrail`（Python 类，`mode: "pre_call"`）：
- 扫描请求体里所有消息内容，正则 + 本地小模型识别凭证；
- 命中后：AES 加密存入金库（`crypto.encrypt` + `redis_store`），生成 `sec_live_xxx`，把原文替换为 `{{secret:sec_xxx}}`；
- 转发给上游模型。模型只看到占位符。
- **可逆性归你掌控**：占位符→真密码的映射在你的金库里，由拦截点 B 在执行时 resolve。

**② 兜底层 — Presidio guardrail（开箱即用，不可逆）**
LiteLLM 内置 Presidio PII masking guardrail，支持自定义正则识别器（ad-hoc recognizer JSON）、`MASK`/`BLOCK` 两种动作、置信度阈值。
- 作用：凡是主层漏掉、但又像密码/密钥/连接串的，**直接 BLOCK 整个请求**（最安全）或 MASK 成 `<SECRET>`。
- 这是**不依赖应用正确性的失效保险**：哪怕你的自定义 guardrail 有 bug，兜底层仍拦住泄露。
- 它不回写你的金库（Presidio 的 un-mask 还有已知 bug），所以它**只做兜底，不做主力** —— 角色定位要清晰。

> **承重决策（已查证）**：guardrail 只在 LiteLLM 的**翻译层**（`/v1/chat/completions`、`/v1/messages`）生效，**不**在 `/anthropic/*` 原生透传上生效。所以 Agent SDK 必须指向 `/v1/messages` 统一端点，**绝不能用 `/anthropic` 透传**，否则拦截点 A 完全失效。

### 4.2 拦截点 B —— 执行注入 + 人工确认（Agent SDK 工具层）

**高危人工确认**：Claude Agent SDK 提供工具调用前的权限回调（`canUseTool` / permission 钩子）。把 BlindVault 的高危规则匹配挂在这里，返回「询问 / 允许 / 拒绝」，弹给用户确认。**不用再自研 `approval_block` 节点**。

**密码注入执行**：把 `secure_shell` 做成 Agent SDK 的自定义工具（in-process）或 MCP 工具：
- 模型用 `$SECRET` / `{{secret:sec_xxx}}` 占位调用；
- 工具内部经 `policy.resolve_secret`（9 步校验原样复用）拿到明文，瞬间注入命令；
- 在隔离沙箱执行（沿用现有 `Dockerfile.sandbox`）；
- 回显经 `_redact_output` 去除真实密码后才返回 —— 而即便这里漏了，回显进入下一轮上下文时还会再过一次拦截点 A 的网关 guardrail（双保险）。

---

## 5. 组件清单与职责

| 组件 | 职责 | 来源 |
|---|---|---|
| BlindVault App (Agent SDK) | agent 循环、工具编排、用户交互、审批 UI | **新建**（薄壳，逻辑靠 SDK） |
| LiteLLM 网关 | 出站咽喉、模型路由、virtual key、guardrail 挂载 | 引入开源 LiteLLM |
| 自定义 guardrail 插件 | 可逆脱敏 + 回写金库 | **改造** `sanitizer.py` |
| Presidio 容器 ×2 | 不可逆兜底识别（analyzer + anonymizer） | 引入开源 Presidio |
| 密码金库 | AES 加密存储 + 9 步校验解析 | **原样复用** `crypto.py` `policy.py` `redis_store.py` |
| secure_shell 工具 | 解密注入 + 沙箱执行 + 输出脱敏 | **改造** `tools/secure_shell.py` |
| 沙箱 | 命令隔离执行 | **原样复用** `Dockerfile.sandbox` |
| 元数据 / 审计库 | 凭证元数据、审计事件 | **复用** PG schema |

---

## 6. 交付形态与部署拓扑

一体化 `docker-compose`（或 Helm chart），客户一条命令拉起：

```
blindvault-app        # Agent SDK 应用 + Web/CLI 入口
litellm-gateway       # 出站咽喉，挂自定义 guardrail + presidio guardrail
presidio-analyzer     # 兜底识别
presidio-anonymizer   # 兜底脱敏
redis                 # 金库热存储
postgres              # 元数据 / 审计 / virtual key
sandbox               # 隔离执行
local-model (可选)     # Ollama/Qwen，给主层 guardrail 做语义识别
```

- **离线/气隙**：上游模型若用你自托管的（经 LiteLLM 路由），整套可完全离线，契合金融/政务一体机场景。
- **多租户 SaaS**：LiteLLM virtual key 分租户，金库按 `tenant_id` 隔离（policy.py 已有 tenant 校验）。

---

## 7. 必须正视的技术风险（含查证发现）

1. **Agent 框架与模型耦合**（已通过选型解决）：Claude Agent SDK 专有且实质绑定 Claude，非 Claude 经 LiteLLM 透传到 OpenAI/Azure 时存在 `input_text` block 被静默丢弃的已知 bug（422）。**已改用 OpenAI Agents SDK**（开源、provider 无关、native OpenAI 格式），从根上规避此类翻译 bug。残留注意：你的自定义 guardrail 解析消息时仍要兼容各家 content block 形态。

2. **guardrail 仅在翻译层生效**：必须走 LiteLLM 的 `/v1/chat/completions`（或 `/v1/messages`）翻译端点，**禁用 `/anthropic/*`、`/openai/*` 等原生透传**，否则拦截点 A 完全失效。

3. **Presidio un-mask 已知 bug**：`async_pre_call_hook` 里 mask 的 token 在 `async_post_call_success_hook` 取不到，导致响应 un-mask 失效。对你**反而无影响**——你本就不希望在响应里 un-mask，占位符要留到工具层 resolve。但要据此明确：**可逆性只走你自己的金库，绝不依赖 Presidio 还原**。

4. **LiteLLM 供应链安全**：PyPI 上 `1.82.7` / `1.82.8` 版本曾被植入窃取凭证的恶意代码。作为安全产品，必须锁定可信版本、校验哈希、最好自建镜像。

5. **脱敏漏报 = 泄露**（老问题，未消失）：拦截点 A 再强，识别率仍是命门。双层（自定义 + Presidio BLOCK 模式）能把风险压到最低，但「未知格式的密钥」永远是残余风险。建议默认对兜底层启用 **BLOCK** 而非 MASK，宁可拦错不可放过。

6. **延迟叠加**：每次出站都过两层 guardrail（含一次本地模型推理 + 一次 Presidio 调用）。需做超时降级与并发压测；本地模型给短超时（沿用现有 2s 降级策略）。

---

## 8. 分阶段路线

**MVP（约 2–4 周）**
- LiteLLM 网关 + `/v1/chat/completions`，配好 GPT 与 Claude 两个 model alias，验证「改一个字符串切换」。
- 自定义 guardrail（移植 sanitizer + 回写金库）跑通可逆脱敏。
- OpenAI Agents SDK 薄壳 + secure_shell 工具 + tool 审批回调实现高危确认。
- 验收：贴密码 / 读 .env / 命令回显三条泄露路径，在 GPT 和 Claude 两种上游下，模型侧都只见占位符。

**V1（再 3–4 周）**
- Presidio 兜底层（BLOCK 模式）+ 自定义凭证识别器。
- virtual key 多租户、审计事件落库、审批留痕。
- 一体化 compose / Helm 交付。

**V2（按需）**
- 上游模型池扩展（Gemini、自托管 Qwen 等），LiteLLM 统一路由 + 按租户/任务做模型策略分流。
- SSO/RBAC、审计导出、策略引擎（你企业版规划的能力，此架构下才有承载点）。

---

## 9. 待决策项

1. **Agent 框架**：✅ 已定 **LangChain `create_agent`（LangGraph runtime）**。理由见顶部「框架选型最终结论」。spike 仅做确认，不再重选。
2. **兜底层动作**：Presidio 默认 **BLOCK**（最安全，可能误拦正常请求）还是 **MASK**（更顺滑，但 masked 内容已脱离你金库不可逆）？
3. **脱敏主层位置**：写成 LiteLLM 自定义 guardrail（推荐，网关唯一咽喉、任意客户端通用）还是放在应用内对输入/工具结果脱敏（覆盖面较窄但更可控）？
4. **模型接入范围**：MVP 先打通 GPT + Claude 两家验证模型无关性，其余（Gemini/自托管）放 V2？
