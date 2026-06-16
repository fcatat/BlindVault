# 任务 #40：本地模型脱敏网关 + EE 子目录建制

> 用户决策（2026-06-15）：
> - 本地模型用途 = **仅用来脱敏**（补正则漏报），不跑整个 agent
> - EE 分离方式 = 同仓 `blindvault_agent/ee/` 子目录 + license 门禁运行时加载
> - 执行顺序：#40 → #37 → #38 → #39

---

## 一、定位与原则

**作用**：用户说"我口令叫 XYZ123"——正则抓不到（没有"密码"等关键字），但 Ollama+Qwen 小模型能听懂上下文识别出来。
**位置**：主层脱敏的**第二层语义补强**，和已弃用的 PII 兜底层完全不同（那个是出站全文扫+block，这个是入站补漏报）。
**降级**：本地模型不可达 / 超时 / 出错 → 静默降级为仅正则模式，用户无感。
**门禁**：无 license 时本地模型路径不加载，社区版只走正则。

---

## 二、EE 子目录建制（顺手做掉，以后所有 EE 功能用）

```
blindvault_agent/
├── ee/
│   ├── __init__.py         # is_ee() / get_ee_features() / require_ee()
│   ├── license.py          # 简版 license 校验
│   └── local_model/
│       ├── __init__.py
│       ├── client.py       # Ollama / OpenAI / custom_fastapi 三协议自适应 + 防幻觉过滤
│       └── settings.py     # local_model_url / model_name / api_type / timeout / system_prompt / disable_cot
```

### `ee/__init__.py` 的核心契约

```python
import os, logging
_logger = logging.getLogger(__name__)
_EE_LICENSE = os.getenv("BLINDVAULT_EE_LICENSE", "").strip()

def is_ee() -> bool:
    """返回当前是否激活 EE。简版：环境变量非空即激活，后续可换 RSA 签名校验。"""
    return bool(_EE_LICENSE)

def get_ee_features() -> dict:
    if not is_ee():
        return {"edition": "community", "features": []}
    return {"edition": "enterprise", "features": ["local_model"]}

def require_ee(feature: str):
    """断言 EE 已激活，否则抛 PermissionError。EE 入口处用。"""
    if not is_ee():
        raise PermissionError(f"功能 '{feature}' 需要 BlindVault EE License")
```

### `ee/license.py`
当前 MVP 阶段直接复用 `is_ee()` 即可，留个文件占位以后可换 RSA 签名 + 到期校验。

---

## 三、本地模型客户端（移植自旧 backend/ee/local_model.py，**改进版**）

`ee/local_model/client.py` 必须包含：

1. **三协议适配**：ollama / openai / custom_fastapi（旧版已有，照搬）
2. **防幻觉过滤**（🔴 核心）：模型返回的 `value` 必须在原文中**实际存在**，否则丢弃。旧版 `_parse_model_output` 已有完整逻辑，直接搬。
3. **超时默认 2s**，超时即降级
4. **system prompt 收紧**：只能识别、不能生成密码——旧版 prompt 设计已严格，直接搬。
5. **disable_cot=True**：禁用思考链（小模型 CoT 会大幅拖慢）
6. **空文本快速返回 []**，不打模型

接口签名（沿用旧版）：
```python
async def extract_secrets(
    text: str,
    *,
    model_url: str,
    model_name: str = "qwen3:0.6b",
    timeout: float = 2.0,
    api_type: str = "ollama",
    system_prompt: str = "",
    disable_cot: bool = True,
) -> list[DetectedSecret]
```

`DetectedSecret`：
```python
@dataclass
class DetectedSecret:
    value: str
    secret_type: str  # password | api_key | private_key | connection_string
    label: str
```

---

## 四、接入主层（🔴 必复审，B 段做）

`blindvault_agent/middleware/reversible_sanitize.py` 的 `detect_secrets_in_text`：

```
1. 跑现有正则规则（DB 加载的 + 连接串）—— 主
2. if is_ee() and local_model_url 配了：
       try:
           model_results = await extract_secrets(text, ...)
           for m in model_results:
               if m.value not in seen_values:  # 去重
                   matches.append(SensitiveMatch(...))
       except Exception:
           logger.warning("本地模型识别失败，降级为仅正则")
3. 返回合并后的 matches
```

铁律保持：正则在前（便宜先拦）、模型在后（贵的补漏）。

**注意**：当前 `detect_secrets_in_text` 是同步函数（被 `ReversibleSanitizeMiddleware.before_model` 同步调用）。本地模型客户端是 async。要么：
- 方案 A：用 `make_sync_save_record` 同款的线程池 sync 桥
- 方案 B：把 detect 也改成 async，middleware 用 await

**优选方案 A**——middleware 改 async 影响面太大，沿用桥即可。

---

## 五、配置与端点

### 配置（`blindvault_agent/ee/local_model/settings.py`）
```
local_model_url: str = ""
local_model_name: str = "qwen3:0.6b"
local_model_api_type: str = "ollama"  # ollama | openai | custom_fastapi
local_model_timeout: float = 2.0
local_model_prompt: str = ""  # 空则用内置默认
local_model_disable_cot: bool = True
```

落 .env：`BLINDVAULT_LOCAL_MODEL_URL` 等。

### 端点（B 段加，`blindvault_agent/web.py`）
- `GET /api/local-model/config` → 返回当前配置（连同 `is_ee` 状态）
- `PUT /api/local-model/config` → 更新配置（必须 require_ee）
- `POST /api/local-model/check` → 健康检查（连通性 + 模型列表，复用旧 `check_model_health`）

---

## 六、前端（B 段）

- 复用现有 `frontend/src/components/LocalModelConfig.tsx`（旧版残留）
- 接通新后端三个端点
- 社区版（is_ee=false）：显示 🔒 PRO 锁 + 介绍文案 "升级 EE 解锁本地模型语义脱敏"
- 企业版（is_ee=true）：完整配置面板（URL/model/api_type/timeout 等）+ 健康检查按钮
- Sidebar 那条 "Local Model Gateway" 根据 `is_ee()` 状态显示 🔒 或可点

---

## 七、🔴 红线（违反 = 任务作废）

1. **防幻觉**：模型返回的 value 必须在原文中实际存在，否则丢弃
2. **降级铁律**：本地模型不可达/超时/异常 → 静默降级到仅正则，绝不阻断主流程
3. **EE 门禁**：`is_ee()=False` 时本地模型路径**完全不加载**（不只是不挂 middleware，是整个 import 路径都不走，防止有人删 license 绕过）
4. **模型自身 prompt 不能让小模型生成密码**：只能识别已有的，不能创造
5. **PUT /api/local-model/config 必须 require_ee**，无 license 直接 403

---

## 八、分段执行

### A 段（无 🔴）
- 建 `blindvault_agent/ee/` 目录结构
- `ee/__init__.py` 实现 is_ee / get_ee_features / require_ee
- `ee/local_model/client.py` 移植旧 `backend/ee/local_model.py`（带防幻觉 + 三协议 + 健康检查）
- `ee/local_model/settings.py` 把字段加进 AgentSettings（带 LOCAL_MODEL_ 前缀）
- 写单元测试 `tests/test_ee_local_model.py`：覆盖防幻觉过滤、超时降级、三协议解析
- **A 段不动主层 middleware、不加 API 端点**，只是搭骨架
- 验收：单元测试全绿、import 路径都能跑通、is_ee 在有/无 EE_LICENSE 时返回正确

### B 段（🔴 必复审）
- 把 client 接进 `reversible_sanitize.detect_secrets_in_text`（带 sync 桥 + 降级 try/except）
- 加 GET/PUT/POST 三个 API 端点
- 前端 `LocalModelConfig.tsx` 接通 + Sidebar PRO 锁逻辑
- 验收：① 配 LOCAL_MODEL_URL 后，输入"我口令叫 XYZ123"能被脱敏成占位符；② 关掉 Ollama，输入同样的话不报错、不脱敏（降级）；③ 无 EE_LICENSE 时配置 UI 显示 PRO 锁；④ #22 那套 e2e 跑过仍全绿。
