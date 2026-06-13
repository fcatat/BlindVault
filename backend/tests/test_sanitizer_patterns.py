"""
test_sanitizer_patterns
─────────────────────────────────────────────
覆盖：去掉内置 fallback 之后，脱敏正则的加载分支。

要点：
- DB 有规则 → 全部以 DB 为准
- DB 无规则 / load_config 抛错 → 运行时返回空列表（无任何内置 fallback）
- update_patterns_cache 立即生效
- detect_secrets 在无规则时也不应崩溃，且不命中
"""

from __future__ import annotations

import json

import pytest

import backend.sanitizer as sanitizer_mod
from backend.sanitizer import (
    SEED_PATTERNS,
    detect_secrets,
    get_compiled_patterns,
    update_patterns_cache,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    """每个测试前清空模块级缓存，避免相互污染。"""
    sanitizer_mod._cached_patterns = []
    sanitizer_mod._initialized = False
    yield
    sanitizer_mod._cached_patterns = []
    sanitizer_mod._initialized = False


@pytest.mark.asyncio
async def test_get_compiled_patterns_uses_db_when_present(monkeypatch):
    """DB 中有规则时，应当全部从 DB 读取，不再混入任何内置默认。"""
    custom = [
        {
            "pattern": r"PRIVATE_KEY=(\S+)",
            "secret_type": "private_key",
            "label": "user-defined",
        },
    ]

    async def fake_load(key: str):
        assert key == "sanitizer_patterns"
        return json.dumps(custom)

    monkeypatch.setattr("backend.db.load_config", fake_load)

    compiled = await get_compiled_patterns()
    assert len(compiled) == 1
    assert compiled[0][2] == "user-defined"


@pytest.mark.asyncio
async def test_get_compiled_patterns_empty_when_db_empty(monkeypatch):
    """DB 没有 sanitizer_patterns 配置时，运行时也不应回退到任何内置规则。"""

    async def fake_load(key: str):
        return None

    monkeypatch.setattr("backend.db.load_config", fake_load)

    compiled = await get_compiled_patterns()
    assert compiled == []


@pytest.mark.asyncio
async def test_get_compiled_patterns_empty_when_db_errors(monkeypatch):
    """DB 加载抛异常时，应当 graceful 降级为空列表，不抛给上层。"""

    async def boom(key: str):
        raise RuntimeError("postgres unreachable")

    monkeypatch.setattr("backend.db.load_config", boom)

    compiled = await get_compiled_patterns()
    assert compiled == []


@pytest.mark.asyncio
async def test_update_patterns_cache_refreshes_immediately():
    """API 端更新规则后，新规则应立即在内存中生效。"""
    new_rules = [
        {
            "pattern": r"X-Token:\s*(\S+)",
            "secret_type": "api_key",
            "label": "x-token",
        }
    ]
    await update_patterns_cache(new_rules)
    compiled = await get_compiled_patterns()
    assert len(compiled) == 1
    assert compiled[0][2] == "x-token"


@pytest.mark.asyncio
async def test_detect_secrets_no_rules_means_no_match(monkeypatch):
    """DB 没有任何规则时，detect_secrets 也不能命中任何敏感值（连接串规则除外）。"""

    async def fake_load(key: str):
        return None

    monkeypatch.setattr("backend.db.load_config", fake_load)

    matches = await detect_secrets("我的密码是 hunter2")
    # 通用密码规则被移除，不应匹配
    assert all(m.value != "hunter2" for m in matches)


@pytest.mark.asyncio
async def test_seed_patterns_round_trip(monkeypatch):
    """SEED_PATTERNS 自身应当可被正常编译并匹配最常见的密码句式。"""
    await update_patterns_cache(SEED_PATTERNS)

    matches = await detect_secrets("我的密码是 hunter2")
    assert any(m.value == "hunter2" for m in matches), "种子规则应能识别『密码是 X』"

    matches = await detect_secrets("password=hunter2")
    assert any(m.value == "hunter2" for m in matches), "种子规则应能识别『password=X』"
