"""
测试：可逆脱敏 Middleware（拦截点 A 主层）

🔴 安全关键测试

验证：
1. before_model 命中凭证 → encrypt 存金库 → 原文替换为 {{secret:sec_xxx}}
2. 连接串密码被检测并替换
3. 模型侧拿不到明文
4. 金库中有对应的加密记录，可解密还原
5. 无敏感信息时不修改消息
6. 已有占位符不会被二次处理
"""

from __future__ import annotations

import base64
import os
import re

import pytest

from blindvault_agent.security.crypto import decrypt
from blindvault_agent.security.models import SecretRecord, SecretStatus
from blindvault_agent.middleware.reversible_sanitize import (
    ReversibleSanitizeMiddleware,
    detect_secrets_in_text,
)
from blindvault_agent.middleware.reversible_sanitize import _BUILTIN_RULES_DATA
import re

class MockRule:
    def __init__(self, data):
        self.name = data["name"]
        self.pattern = data["pattern"]
        self.secret_type = data["secret_type"]
        self.label = data["label"]
        self.capture_group = data["capture_group"]
        self.enabled = data["enabled"]
        self.is_builtin = data["is_builtin"]
        self.compiled_pattern = re.compile(self.pattern, re.IGNORECASE)

_TEST_RULES = [MockRule(d) for d in _BUILTIN_RULES_DATA]

def mock_load_rules():
    return _TEST_RULES



# 固定测试密钥
TEST_KEY_RAW = os.urandom(32)


# ============================================================
# 模拟消息对象（无需依赖 langchain）
# ============================================================

class FakeMessage:
    """简单模拟 langchain 消息对象。"""
    def __init__(self, content=None, role: str = "user", tool_calls=None):
        self.content = content if content is not None else ""
        self.role = role
        self.tool_calls = tool_calls

    def model_copy(self, update=None):
        new = FakeMessage(self.content, self.role, self.tool_calls)
        if update:
            if "content" in update:
                new.content = update["content"]
            if "tool_calls" in update:
                new.tool_calls = update["tool_calls"]
        return new


# ============================================================
# 同步金库 mock
# ============================================================

class MockVault:
    """同步金库 mock：存储 SecretRecord，供测试验证。"""
    def __init__(self):
        self.records: dict[str, SecretRecord] = {}

    def save_record(self, record: SecretRecord) -> None:
        self.records[record.secret_ref] = record

    def get(self, ref: str) -> SecretRecord | None:
        return self.records.get(ref)


@pytest.fixture
def vault():
    return MockVault()


@pytest.fixture
def middleware(vault):
    return ReversibleSanitizeMiddleware(
        save_record=vault.save_record,
        encryption_key=TEST_KEY_RAW,
        load_rules=mock_load_rules,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
    )


# ============================================================
# 测试：detect_secrets_in_text（纯正则检测）
# ============================================================


def test_detect_cn_password():
    """中文密码模式检测。"""
    matches = detect_secrets_in_text("服务器密码是 MyP@ssw0rd123", _TEST_RULES)
    assert len(matches) == 1
    assert matches[0].value == "MyP@ssw0rd123"
    assert matches[0].secret_type == "password"


def test_detect_en_password():
    """英文密码模式检测。"""
    matches = detect_secrets_in_text("password=SuperSecret!", _TEST_RULES)
    assert len(matches) == 1
    assert matches[0].value == "SuperSecret!"
    assert matches[0].secret_type == "password"


def test_detect_connstr_password():
    """连接串密码检测。"""
    matches = detect_secrets_in_text("连接 mysql://root:s3cretPass@db:3306/mydb", _TEST_RULES)
    assert len(matches) == 1
    assert matches[0].value == "s3cretPass"
    assert matches[0].secret_type == "password"
    assert matches[0].label == "auto_connstr_password"


def test_detect_multiple_secrets():
    """同时检测多种凭证。"""
    text = "密码是 abc123，连接串是 postgresql://user:dbpass@host:5432/db"
    matches = detect_secrets_in_text(text, _TEST_RULES)
    assert len(matches) == 2
    values = {m.value for m in matches}
    assert "abc123" in values
    assert "dbpass" in values


def test_detect_skip_placeholders():
    """已有占位符不应被检测。"""
    matches = detect_secrets_in_text("密码是 {{secret:sec_live_abc123}}", _TEST_RULES)
    assert len(matches) == 0


def test_detect_skip_secret_refs():
    """已有 secret_ref 不应被检测。"""
    matches = detect_secrets_in_text("密码是 sec_live_abc123def456", _TEST_RULES)
    assert len(matches) == 0


def test_detect_skip_query_words():
    """问询词不应被当作密码。"""
    matches = detect_secrets_in_text("密码是什么", _TEST_RULES)
    assert len(matches) == 0


def test_detect_no_secrets():
    """无敏感信息应返回空列表。"""
    matches = detect_secrets_in_text("你好，请帮我查看服务器状态", _TEST_RULES)
    assert len(matches) == 0


def test_detect_api_key():
    """API Key 模式检测。"""
    matches = detect_secrets_in_text("api_key=sk_test_abcdefghijklmnopqrstuvwxyz", _TEST_RULES)
    assert len(matches) == 1
    assert matches[0].secret_type == "api_key"


def test_detect_ordered_back_to_front():
    """匹配结果应按位置从后向前排序。"""
    text = "密码是 first，password=second"
    matches = detect_secrets_in_text(text, _TEST_RULES)
    assert len(matches) == 2
    # 从后向前：second 在后面
    assert matches[0].value_start > matches[1].value_start


# ============================================================
# 测试：ReversibleSanitizeMiddleware.before_model
# ============================================================


def test_middleware_sanitize_password(middleware):
    """before_model 应检测密码并替换为占位符。"""
    state = {"messages": [FakeMessage("密码是 MySecret123")]}
    result = middleware.before_model(state)

    assert result is not None
    content = result["messages"][0].content
    assert "MySecret123" not in content
    assert "{{secret:sec_live_" in content
    assert middleware.sanitize_count == 1


def test_middleware_sanitize_connstr(middleware):
    """before_model 应检测连接串密码并替换。"""
    state = {"messages": [FakeMessage("连接 mysql://admin:s3cretP4ss@db.example.com:3306")]}
    result = middleware.before_model(state)

    assert result is not None
    content = result["messages"][0].content
    assert "s3cretP4ss" not in content
    assert "{{secret:" in content


def test_middleware_no_secrets(middleware):
    """无敏感信息时应返回 None（不修改）。"""
    state = {"messages": [FakeMessage("请帮我查看服务器负载")]}
    result = middleware.before_model(state)
    assert result is None
    assert middleware.sanitize_count == 0


def test_middleware_preserve_non_sensitive(middleware):
    """脱敏替换后，非敏感内容应保持不变。"""
    state = {"messages": [FakeMessage("请登录服务器 192.168.1.1，密码是 Admin@2026，然后执行 df -h")]}
    result = middleware.before_model(state)

    assert result is not None
    content = result["messages"][0].content
    assert "192.168.1.1" in content
    assert "df -h" in content
    assert "Admin@2026" not in content
    assert "{{secret:" in content


def test_middleware_multiple_messages(middleware):
    """多条消息都应被扫描。"""
    state = {
        "messages": [
            FakeMessage("密码是 pass1"),
            FakeMessage("你好，这是普通消息"),
            FakeMessage("password=pass2"),
        ],
    }

    result = middleware.before_model(state)
    assert result is not None
    messages = result["messages"]
    assert len(messages) == 3

    assert "pass1" not in messages[0].content
    assert "{{secret:" in messages[0].content
    assert "普通消息" in messages[1].content
    assert "pass2" not in messages[2].content
    assert "{{secret:" in messages[2].content
    assert middleware.sanitize_count == 2


def test_middleware_vault_stores_secret(middleware, vault):
    """金库中应有加密后的 secret 记录，可解密还原。"""
    state = {"messages": [FakeMessage("密码是 VaultTestPwd!")]}
    result = middleware.before_model(state)

    assert result is not None
    content = result["messages"][0].content

    # 提取 secret_ref
    ref_match = re.search(r'\{\{secret:(sec_live_[A-Za-z0-9_-]+)\}\}', content)
    assert ref_match is not None
    secret_ref = ref_match.group(1)

    # 验证金库记录
    record = vault.get(secret_ref)
    assert record is not None
    assert record.status == SecretStatus.ACTIVE
    assert record.user_id == "test_user"
    assert record.tenant_id == "default"
    assert record.allowed_tools == ["secure_shell"]

    # 解密验证
    plaintext = decrypt(record.ciphertext, TEST_KEY_RAW)
    assert plaintext == "VaultTestPwd!"


def test_middleware_idempotent(middleware):
    """已包含占位符的消息不应被二次处理。"""
    state = {"messages": [FakeMessage("连接 {{secret:sec_live_abc123}} 执行命令")]}
    result = middleware.before_model(state)
    assert result is None


def test_middleware_vault_failure_blocks():
    """金库不可达时不放行——应抛异常。"""
    def failing_save(record):
        raise ConnectionError("Redis 不可达")

    mw = ReversibleSanitizeMiddleware(
        save_record=failing_save,
        encryption_key=TEST_KEY_RAW,
        load_rules=mock_load_rules,
    )

    state = {"messages": [FakeMessage("密码是 ShouldFail123")]}
    with pytest.raises(ConnectionError):
        mw.before_model(state)


# ============================================================
# S1 测试：list-form content + tool_calls args
# ============================================================


def test_middleware_list_content(middleware):
    """S1: list-form content blocks 中的密码应被检测。"""
    msg = FakeMessage(
        content=[
            {"type": "text", "text": "密码是 ListPwd123"},
            {"type": "image_url", "image_url": "https://example.com/img.png"},
        ]
    )
    state = {"messages": [msg]}
    result = middleware.before_model(state)

    assert result is not None
    content = result["messages"][0].content
    # list-form content 中的文本应被替换
    assert isinstance(content, list)
    text_block = content[0]
    assert "ListPwd123" not in text_block["text"]
    assert "{{secret:" in text_block["text"]


def test_middleware_tool_calls_args(middleware):
    """S1: tool_calls args 中的密码应被检测。"""
    msg = FakeMessage(
        content="请执行命令",
        tool_calls=[
            {
                "name": "secure_shell",
                "args": {
                    "command": "psql postgresql://user:ToolCallPwd123@db:5432/mydb",
                },
                "id": "tc_1",
            }
        ],
    )
    state = {"messages": [msg]}
    result = middleware.before_model(state)

    assert result is not None
    new_msg = result["messages"][0]
    # tool_calls args 中的连接串密码应被替换
    assert "ToolCallPwd123" not in str(new_msg.tool_calls)
    assert "{{secret:" in str(new_msg.tool_calls)

