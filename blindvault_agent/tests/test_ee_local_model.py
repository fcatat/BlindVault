import os
import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
import httpx

from blindvault_agent.ee import is_ee, get_ee_features, require_ee
from blindvault_agent.ee.local_model.client import (
    extract_secrets,
    _parse_model_output,
    DetectedSecret,
)

# ============================================================
# EE License Tests
# ============================================================
def test_is_ee_env_var():
    with patch.dict(os.environ, {"BLINDVAULT_EE_LICENSE": "test"}):
        from importlib import reload
        import blindvault_agent.ee
        reload(blindvault_agent.ee)
        assert blindvault_agent.ee.is_ee() is True
        assert blindvault_agent.ee.get_ee_features() == {"edition": "enterprise", "features": ["local_model"]}
        
    with patch.dict(os.environ, {"BLINDVAULT_EE_LICENSE": ""}):
        from importlib import reload
        import blindvault_agent.ee
        reload(blindvault_agent.ee)
        assert blindvault_agent.ee.is_ee() is False
        assert blindvault_agent.ee.get_ee_features() == {"edition": "community", "features": []}
        with pytest.raises(PermissionError):
            blindvault_agent.ee.require_ee("local_model")

# ============================================================
# _parse_model_output 解析测试 (带防幻觉与 markdown)
# ============================================================

class TestParseModelOutput:
    def test_valid_json_output(self):
        original = "帮我连 10.14.101.22 用户root 口令 abc@123 看看磁盘"
        content = '[{"value": "abc@123", "type": "password", "label": "root 登录口令"}]'
        results = _parse_model_output(content, original)
        assert len(results) == 1
        assert results[0].value == "abc@123"

    def test_hallucination_filter(self):
        original = "帮我查下服务器状态"
        content = '[{"value": "fake_password_123", "type": "password", "label": "幻觉密码"}]'
        results = _parse_model_output(content, original)
        assert results == []

    def test_markdown_wrapped_json(self):
        original = "用 sk-proj-abc123 调接口"
        content = '```json\n[{"value": "sk-proj-abc123", "type": "api_key", "label": "API 密钥"}]\n```'
        results = _parse_model_output(content, original)
        assert len(results) == 1
        assert results[0].value == "sk-proj-abc123"

# ============================================================
# extract_secrets 降级与协议测试
# ============================================================

class TestExtractSecretsDegradation:
    @pytest.mark.asyncio
    @patch("httpx.AsyncClient.post")
    async def test_timeout_returns_empty(self, mock_post):
        mock_post.side_effect = httpx.TimeoutException("simulated timeout")
        results = await extract_secrets(
            "密码 abc123",
            model_url="http://fake",
            timeout=0.1,
        )
        assert results == []

    @pytest.mark.asyncio
    @patch("httpx.AsyncClient.post")
    async def test_api_protocols(self, mock_post):
        # 1. custom_fastapi string
        mock_response_fastapi = MagicMock()
        mock_response_fastapi.status_code = 200
        mock_response_fastapi.json.return_value = {
            "output": '[{"value": "my_pwd_123", "type": "password", "label": "pwd"}]'
        }

        # 1b. custom_fastapi list
        mock_response_fastapi_list = MagicMock()
        mock_response_fastapi_list.status_code = 200
        mock_response_fastapi_list.json.return_value = {
            "output": [
                {
                    "type": "message",
                    "content": '[{"value": "my_pwd_123", "type": "password", "label": "pwd"}]'
                }
            ]
        }
        
        # 2. openai
        mock_response_openai = MagicMock()
        mock_response_openai.status_code = 200
        mock_response_openai.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '[{"value": "my_pwd_123", "type": "password", "label": "pwd"}]'
                    }
                }
            ]
        }

        mock_post.side_effect = [
            mock_response_fastapi,
            mock_response_fastapi_list,
            mock_response_openai
        ]

        res_fastapi = await extract_secrets(
            "测试口令 my_pwd_123",
            model_url="http://fake-api",
            api_type="custom_fastapi",
        )
        assert len(res_fastapi) == 1
        assert res_fastapi[0].value == "my_pwd_123"

        res_fastapi_list = await extract_secrets(
            "测试口令 my_pwd_123",
            model_url="http://fake-api",
            api_type="custom_fastapi",
        )
        assert len(res_fastapi_list) == 1
        assert res_fastapi_list[0].value == "my_pwd_123"

        res_openai = await extract_secrets(
            "测试口令 my_pwd_123",
            model_url="http://fake-api",
            api_type="openai",
        )
        assert len(res_openai) == 1
        assert res_openai[0].value == "my_pwd_123"
