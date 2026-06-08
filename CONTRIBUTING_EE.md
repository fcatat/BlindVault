# BlindVault 企业版开发规范

## 1. 仓库架构

```
BlindVault-ee (私有)  ←  开发主仓库，包含全部代码
    │
    │ CI 自动剥离 ee/ → 推送
    ▼
BlindVault (公开)     ←  社区版只读镜像
```

**核心规则**：
- 所有日常开发只在**一个本地工作目录**进行
- 企业版代码推送：`git push ee main`
- 社区版同步由 CI 自动完成，或手动 `git push origin main`（需先确认不含 ee/ 代码）
- **永远不要**直接把含 `ee/` 的代码 push 到 `origin`

---

## 2. 目录隔离规范

所有企业版代码必须放在 `ee/` 目录下：

```
backend/ee/         ← 后端企业版模块
frontend/src/ee/    ← 前端企业版组件
```

**在社区版代码中引用企业版功能时**，必须使用条件导入 + 降级：

```python
# ✅ 正确：条件导入 + 降级
settings = get_settings()
if settings.local_model_url:
    try:
        from backend.ee.local_model import extract_secrets as model_extract
        results = await model_extract(...)
    except Exception:
        logger.warning("[EE] 降级为正则模式")

# ❌ 错误：顶层无条件导入
from backend.ee.local_model import extract_secrets  # 社区版会报 ImportError
```

---

## 3. 本地模型集成规范

### 3.1 模型任务设计

本地模型执行的是**敏感信息实体提取（NER）**任务，不是对话任务。

System Prompt 定义在 `backend/ee/local_model.py` 的 `_SYSTEM_PROMPT` 变量中。

**输入**：用户的原始自然语言消息
**输出**：JSON 数组，每个元素包含 `value`、`type`、`label`

### 3.2 更换模型

如果要更换模型（例如从 Qwen3-0.6B 换成其他模型），只需：

1. 在 Mac Mini 上通过 Ollama 拉取新模型：`ollama pull <新模型名>`
2. 在 BlindVault 前端「本地模型网关」配置页面修改「模型名称」字段
3. 点击「检测连通性」验证新模型可用
4. 保存配置

**无需修改任何代码**。System Prompt 是通用的，兼容所有支持 JSON 输出的模型。

### 3.3 如果需要调整 Prompt

修改 `backend/ee/local_model.py` 中的 `_SYSTEM_PROMPT` 变量即可。注意：
- 必须要求模型输出 JSON 数组格式
- 必须包含 `value`、`type` 字段
- `type` 必须是 `_parse_model_output` 函数中 `valid_types` 集合内的值

### 3.4 防幻觉校验

`_parse_model_output()` 函数对模型输出做了 4 层校验，**切勿绕过**：

1. `value` 长度 ≥ 3
2. `type` 在预定义类型集合中
3. `value` 在原始文本中实际存在（核心防幻觉）
4. 去重

---

## 4. 配置项命名规范

企业版配置项统一使用 `local_model_` 前缀（后端 Python）：

| 配置项 | 环境变量 | 说明 |
|:---|:---|:---|
| `local_model_url` | `LOCAL_MODEL_URL` | Ollama 服务地址 |
| `local_model_name` | `LOCAL_MODEL_NAME` | 模型名称 |
| `local_model_timeout` | `LOCAL_MODEL_TIMEOUT` | 推理超时（秒） |

新增企业版配置时，在 `backend/config.py` 的 `# ---- 企业版 ----` 区块添加。

---

## 5. 前端 UI 规范

### 5.1 企业版 UI 标识

- 使用 **amber（琥珀色）** 色调区分企业版功能（社区版使用 primary 紫色）
- 在面板标题旁添加 `Enterprise` 徽章
- 输入框 focus 边框使用 `border-amber-500`

### 5.2 i18n 键命名

企业版翻译键使用 `config.localModel` 前缀：
```
config.localModelTitle
config.localModelUrl
config.localModelName
...
```

---

## 6. 测试规范

- 单元测试文件放在 `backend/tests/` 目录
- 命名格式：`test_<模块名>.py`
- 异步测试使用 `@pytest.mark.asyncio` 装饰器
- 降级场景必须有对应的测试用例
