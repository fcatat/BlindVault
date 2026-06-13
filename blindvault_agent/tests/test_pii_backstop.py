"""
测试：PII 兜底 Middleware（拦截点 A 兜底层）

🔴 安全关键测试

验证：
1. 主层漏掉的凭证被兜底层检测并阻断
2. 已被主层处理的占位符不触发误报
3. 普通文本不触发
4. 各类凭证格式（连接串、私钥、API Key、AWS Key）都能检测
5. disabled 状态不阻断
"""

from __future__ import annotations

import pytest

from blindvault_agent.middleware.pii_backstop import (
    PIIBackstopMiddleware,
    PIIBlockError,
    detect_pii_leaks,
)


# ============================================================
# 模拟消息对象
# ============================================================

class FakeMessage:
    def __init__(self, content: str):
        self.content = content


# ============================================================
# 测试：detect_pii_leaks（检测引擎）
# ============================================================


def test_detect_connection_string():
    """连接串应被检测。"""
    result = detect_pii_leaks("连接 postgresql://admin:s3cret@db:5432/prod")
    assert result == "connection_string"


def test_detect_private_key():
    """私钥标记应被检测。"""
    result = detect_pii_leaks("这是密钥内容 -----BEGIN RSA PRIVATE KEY----- xxx")
    assert result == "private_key"


def test_detect_aws_key():
    """AWS Access Key 应被检测（可能被 high_entropy_token 或 aws_access_key 匹配）。"""
    result = detect_pii_leaks("使用 AKIAIOSFODNN7EXAMPLE 访问 S3")
    assert result is not None  # 兜底层只需检测到，不要求精确分类


def test_detect_password_assignment():
    """password=xxx 赋值应被检测。"""
    result = detect_pii_leaks("配置文件中 password=MyS3cretP@ss")
    assert result == "password_assignment"


def test_detect_high_entropy_token():
    """已知前缀的高熵 token 应被检测。"""
    result = detect_pii_leaks("使用 sk-abcdefghijklmnopqrstuvwxyz1234567890 调用API")
    assert result == "high_entropy_token"


def test_no_leak_normal_text():
    """普通文本不应触发。"""
    result = detect_pii_leaks("请帮我查看服务器 192.168.1.1 的磁盘使用情况")
    assert result is None


def test_no_leak_placeholder():
    """已被主层处理的占位符不应触发。"""
    result = detect_pii_leaks("密码已替换为 {{secret:sec_live_abc123def456}}")
    assert result is None


def test_no_leak_password_query():
    """询问密码的文本不应触发。"""
    result = detect_pii_leaks("password is what")
    assert result is None


def test_no_leak_password_none():
    """password=none 不应触发。"""
    result = detect_pii_leaks("password=none")
    assert result is None


# ============================================================
# 测试：PIIBackstopMiddleware
# ============================================================


def test_middleware_blocks_leaked_secret():
    """主层漏掉的凭证应被兜底层阻断。"""
    mw = PIIBackstopMiddleware()
    state = {
        "messages": [
            FakeMessage("连接数据库 postgresql://root:leaked_pwd@db:5432/prod"),
        ],
    }
    with pytest.raises(PIIBlockError):
        mw.before_model(state)
    assert mw.block_count == 1


def test_middleware_allows_clean_messages():
    """干净消息不应被阻断。"""
    mw = PIIBackstopMiddleware()
    state = {
        "messages": [
            FakeMessage("请查看 df -h 的输出"),
            FakeMessage("密码已替换为 {{secret:sec_live_abc123}}，请执行命令"),
        ],
    }
    result = mw.before_model(state)
    assert result is None
    assert mw.block_count == 0


def test_middleware_blocks_private_key():
    """私钥应被阻断。"""
    mw = PIIBackstopMiddleware()
    state = {
        "messages": [
            FakeMessage("-----BEGIN PRIVATE KEY----- MIIEvgIBADANBg..."),
        ],
    }
    with pytest.raises(PIIBlockError):
        mw.before_model(state)


def test_middleware_disabled():
    """disabled 状态不阻断。"""
    mw = PIIBackstopMiddleware(enabled=False)
    state = {
        "messages": [
            FakeMessage("postgresql://root:leaked@db:5432"),
        ],
    }
    result = mw.before_model(state)
    assert result is None
    assert mw.block_count == 0


def test_middleware_blocks_high_entropy_token():
    """高熵 token 应被阻断。"""
    mw = PIIBackstopMiddleware()
    state = {
        "messages": [
            FakeMessage("请用 ghp_abcdefghijklmnopqrstuvwxyz123456 访问仓库"),
        ],
    }
    with pytest.raises(PIIBlockError):
        mw.before_model(state)


def test_backstop_after_main_layer():
    """
    核心验收：主层处理后的消息通过兜底层，
    但故意遗漏一个密钥时被兜底层阻断。
    """
    mw = PIIBackstopMiddleware()

    # 场景 1：主层已处理完毕，兜底层放行
    state_clean = {
        "messages": [
            FakeMessage("登录 {{secret:sec_live_abc123}} 执行 ls -la"),
        ],
    }
    assert mw.before_model(state_clean) is None

    # 场景 2：主层漏掉一个 AWS Key，兜底层阻断
    state_leaked = {
        "messages": [
            FakeMessage("登录 {{secret:sec_live_abc123}} 使用 AKIAIOSFODNN7EXAMPLE"),
        ],
    }
    with pytest.raises(PIIBlockError):
        mw.before_model(state_leaked)


def test_error_message_is_generic():
    """错误消息不应暴露具体匹配内容。"""
    mw = PIIBackstopMiddleware()
    state = {
        "messages": [
            FakeMessage("password=SuperSecretValue123"),
        ],
    }
    with pytest.raises(PIIBlockError) as exc_info:
        mw.before_model(state)

    error_msg = str(exc_info.value)
    assert "SuperSecretValue123" not in error_msg
    assert "blocked" in error_msg.lower() or "backstop" in error_msg.lower()
