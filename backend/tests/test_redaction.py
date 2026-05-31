"""
测试：日志脱敏

验证：
1. 日志脱敏函数能隐藏 password/token/api_key
2. secret_ref 部分脱敏
3. 嵌套 dict 也能正确脱敏
"""

from __future__ import annotations

import pytest

from backend.redaction import (
    redact_log_message,
    redact_secret_ref,
    redact_sensitive_fields,
)


def test_redact_password_field():
    """password 字段应被脱敏。"""
    data = {"username": "admin", "password": "super_secret_123"}
    result = redact_sensitive_fields(data)
    assert result["username"] == "admin"
    assert result["password"] == "[REDACTED]"


def test_redact_token_field():
    """token 字段应被脱敏。"""
    data = {"access_token": "eyJhbGci...", "user": "test"}
    result = redact_sensitive_fields(data)
    assert result["access_token"] == "[REDACTED]"
    assert result["user"] == "test"


def test_redact_api_key_field():
    """api_key 字段应被脱敏。"""
    data = {"api_key": "sk-12345", "model": "gpt-4"}
    result = redact_sensitive_fields(data)
    assert result["api_key"] == "[REDACTED]"
    assert result["model"] == "gpt-4"


def test_redact_authorization_header():
    """authorization 字段应被脱敏。"""
    data = {"authorization": "Bearer eyJhbG..."}
    result = redact_sensitive_fields(data)
    assert result["authorization"] == "[REDACTED]"


def test_redact_cookie_field():
    """cookie 字段应被脱敏。"""
    data = {"cookie": "session=abc123", "path": "/api"}
    result = redact_sensitive_fields(data)
    assert result["cookie"] == "[REDACTED]"
    assert result["path"] == "/api"


def test_redact_nested_dict():
    """嵌套 dict 中的敏感字段也应被脱敏。"""
    data = {
        "user": "admin",
        "credentials": {
            "password": "secret",
            "token": "abc123",
        },
        "settings": {
            "api_key": "sk-xxx",
            "timeout": 30,
        },
    }
    result = redact_sensitive_fields(data)
    assert result["user"] == "admin"
    assert result["credentials"]["password"] == "[REDACTED]"
    assert result["credentials"]["token"] == "[REDACTED]"
    assert result["settings"]["api_key"] == "[REDACTED]"
    assert result["settings"]["timeout"] == 30


def test_redact_list_with_dicts():
    """列表中包含 dict 的敏感字段也应被脱敏。"""
    data = [
        {"password": "secret1", "name": "a"},
        {"password": "secret2", "name": "b"},
    ]
    result = redact_sensitive_fields(data)
    assert result[0]["password"] == "[REDACTED]"
    assert result[0]["name"] == "a"
    assert result[1]["password"] == "[REDACTED]"


def test_redact_secret_ref_partial():
    """secret_ref 应部分脱敏：保留前缀 + 前 4 字符。"""
    text = "Secret ref is sec_live_abcdefgh12345678"
    result = redact_secret_ref(text)
    assert "sec_live_abcd****" in result
    assert "abcdefgh12345678" not in result


def test_redact_secret_ref_in_placeholder():
    """placeholder 格式中的 secret_ref 也应脱敏。"""
    text = "Using {{secret:sec_live_xyz123abc456def}} for login"
    result = redact_secret_ref(text)
    # secret_ref 部分已脱敏
    assert "xyz123abc456def" not in result


def test_redact_multiple_secret_refs():
    """多个 secret_ref 都应被脱敏。"""
    text = "ref1=sec_live_aaaa1111bbbb2222 ref2=sec_test_cccc3333dddd4444"
    result = redact_secret_ref(text)
    assert "aaaa1111bbbb2222" not in result
    assert "cccc3333dddd4444" not in result
    assert "sec_live_aaaa****" in result
    assert "sec_test_cccc****" in result


def test_redact_log_message_combined():
    """综合脱敏：同时处理 secret_ref。"""
    msg = "User logged in with sec_live_test123456789abc"
    result = redact_log_message(msg)
    assert "test123456789abc" not in result
    assert "sec_live_test****" in result


def test_redact_does_not_modify_safe_fields():
    """非敏感字段不应被修改。"""
    data = {
        "username": "admin",
        "email": "admin@example.com",
        "role": "superadmin",
        "count": 42,
    }
    result = redact_sensitive_fields(data)
    assert result == data


def test_redact_value_field():
    """value 字段应被脱敏（创建 secret 时的字段名）。"""
    data = {"label": "my key", "value": "real_secret_here"}
    result = redact_sensitive_fields(data)
    assert result["value"] == "[REDACTED]"
    assert result["label"] == "my key"
