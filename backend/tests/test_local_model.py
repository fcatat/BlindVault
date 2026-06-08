"""
本地模型客户端单元测试

测试点：
1. 模型输出解析与防幻觉校验
2. 连接失败自动降级
3. 超时自动降级
4. 空输入处理
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from backend.ee.local_model import (
    extract_secrets,
    _parse_model_output,
    DetectedSecret,
    check_model_health,
)


# ============================================================
# _parse_model_output 解析测试
# ============================================================

class TestParseModelOutput:
    """模型输出解析 + 防幻觉校验。"""

    def test_valid_json_output(self):
        """正常 JSON 输出。"""
        original = "帮我连 10.14.101.22 用户root 口令 abc@123 看看磁盘"
        content = '[{"value": "abc@123", "type": "password", "label": "root 登录口令"}]'
        results = _parse_model_output(content, original)
        assert len(results) == 1
        assert results[0].value == "abc@123"
        assert results[0].secret_type == "password"
        assert results[0].label == "root 登录口令"

    def test_empty_array(self):
        """无敏感信息。"""
        results = _parse_model_output("[]", "看看服务器状态")
        assert results == []

    def test_markdown_wrapped_json(self):
        """模型用 markdown 代码块包裹的 JSON。"""
        original = "用 sk-proj-abc123 调接口"
        content = '```json\n[{"value": "sk-proj-abc123", "type": "api_key", "label": "API 密钥"}]\n```'
        results = _parse_model_output(content, original)
        assert len(results) == 1
        assert results[0].value == "sk-proj-abc123"

    def test_hallucination_filter(self):
        """防幻觉：模型输出的 value 不存在于原文中。"""
        original = "帮我查下服务器状态"
        content = '[{"value": "fake_password_123", "type": "password", "label": "幻觉密码"}]'
        results = _parse_model_output(content, original)
        assert results == []

    def test_short_value_filter(self):
        """过滤过短的值（< 3 字符）。"""
        original = "密码是 ab"
        content = '[{"value": "ab", "type": "password", "label": "短密码"}]'
        results = _parse_model_output(content, original)
        assert results == []

    def test_invalid_type_filter(self):
        """过滤未预定义的类型。"""
        original = "用户名 admin"
        content = '[{"value": "admin", "type": "username", "label": "用户名"}]'
        results = _parse_model_output(content, original)
        assert results == []

    def test_dedup(self):
        """去重：同一个值只保留一次。"""
        original = "密码 abc123 口令也是 abc123"
        content = '[{"value": "abc123", "type": "password", "label": "a"}, {"value": "abc123", "type": "password", "label": "b"}]'
        results = _parse_model_output(content, original)
        assert len(results) == 1

    def test_multiple_secrets(self):
        """多个不同的敏感值。"""
        original = "root/abc123 登录 10.1.1.1，API key 是 sk-xyz789"
        content = '[{"value": "abc123", "type": "password", "label": "root 密码"}, {"value": "sk-xyz789", "type": "api_key", "label": "API 密钥"}]'
        results = _parse_model_output(content, original)
        assert len(results) == 2

    def test_garbage_output(self):
        """模型输出乱码。"""
        results = _parse_model_output("I cannot help with that.", "看看状态")
        assert results == []

    def test_empty_content(self):
        """空输出。"""
        results = _parse_model_output("", "看看状态")
        assert results == []

    def test_json_with_extra_text(self):
        """JSON 前后有多余文字。"""
        original = "密码是 mypass123"
        content = '好的，分析结果如下：\n[{"value": "mypass123", "type": "password", "label": "密码"}]\n以上就是识别结果。'
        results = _parse_model_output(content, original)
        assert len(results) == 1
        assert results[0].value == "mypass123"


# ============================================================
# extract_secrets 降级测试
# ============================================================

class TestExtractSecretsDegradation:
    """模型不可用时的降级行为。"""

    @pytest.mark.asyncio
    async def test_empty_input(self):
        """空输入直接返回空。"""
        results = await extract_secrets("", model_url="http://fake:11434")
        assert results == []

    @pytest.mark.asyncio
    async def test_connect_error_graceful(self):
        """连接失败时静默降级，返回空列表而非抛异常。"""
        results = await extract_secrets(
            "密码是 abc123",
            model_url="http://192.168.255.255:11434",
            timeout=0.5,
        )
        assert results == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
