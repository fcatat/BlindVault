import re

with open("blindvault_agent/middleware/reversible_sanitize.py", "r") as f:
    content = f.read()

# 1. Replace _PATTERN_* with _BUILTIN_RULES_DATA
new_builtin = """# ============================================================
# 内置正则规则（数据源）
# ============================================================

_BUILTIN_RULES_DATA = [
    {
        "name": "中文上下文密码",
        "pattern": r'(?:密码|口令|秘密|pass|pwd)(?:\s*[:：=是为]\s*|\s+是\s+|\s+为\s+|(?:设置|改|设|修改|更改|改成|设成)(?:为|成)\s*|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "auto_cn_password",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "英文上下文密码",
        "pattern": r'(?:password|passwd|pwd)(?:\s*[:=]\s*|\s+is\s+|\s+)([^\s,，。；;、\n\r]+)',
        "secret_type": "password",
        "label": "auto_en_password",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "连接串密码",
        "pattern": r'((?:postgresql|postgres|mysql|redis|mongodb|amqp|mqtt)://[^:@\s]*:)([^@\s]+)(@[^\s,，。；;、]+)',
        "secret_type": "password",
        "label": "auto_connstr_password",
        "capture_group": 2,
        "enabled": True,
        "is_builtin": True,
    },
    {
        "name": "API Key",
        "pattern": r'(?:api[_-]?key|token|secret[_-]?key|access[_-]?key)(?:\s*[:=]\s*|\s+is\s+|\s+)([A-Za-z0-9_\-\.]{20,})',
        "secret_type": "api_key",
        "label": "auto_api_key",
        "capture_group": 1,
        "enabled": True,
        "is_builtin": True,
    }
]

# 应跳过的常见问询词
"""

content = re.sub(
    r'# 内置正则规则.*?# 应跳过的常见问询词\n',
    new_builtin,
    content,
    flags=re.DOTALL
)

# 2. Modify detect_secrets_in_text
old_detect = """def detect_secrets_in_text(text: str) -> list[SensitiveMatch]:
    \"\"\"
    从文本中检测敏感信息。纯确定性正则，无 I/O。

    返回按位置从后向前排序的匹配列表（方便从后往前替换不影响偏移）。
    \"\"\"
    matches: list[SensitiveMatch] = []
    seen_values: set[str] = set()

    # ---- 第一层：内置正则规则 ----
    for pattern, secret_type, label, group_idx in _BUILTIN_RULES:"""

new_detect = """def detect_secrets_in_text(text: str, compiled_rules: list) -> list[SensitiveMatch]:
    \"\"\"
    从文本中检测敏感信息。纯确定性正则，无 I/O。

    返回按位置从后向前排序的匹配列表（方便从后往前替换不影响偏移）。
    \"\"\"
    matches: list[SensitiveMatch] = []
    seen_values: set[str] = set()

    # ---- 正则规则匹配 ----
    for rule in compiled_rules:
        if not rule.enabled:
            continue
        pattern = rule.compiled_pattern
        for m in pattern.finditer(text):
            group_idx = rule.capture_group"""

content = content.replace(old_detect, new_detect)

# 3. Modify inside detect_secrets_in_text loop
old_loop = """            # 过滤：太短、已是占位符、问询词、重复
            if len(value) < 3:
                continue
            if value.startswith("{{secret:") or value.startswith("sec_live_"):
                continue
            if value == "[REDACTED]" or value == "$SECRET":
                continue
            if value.lower() in _SKIP_WORDS:
                continue
            if value in seen_values:
                continue
            seen_values.add(value)

            matches.append(SensitiveMatch(
                secret_type=secret_type,
                label=label,
                value=value,
                value_start=val_start,
                value_end=val_end,
            ))

    # ---- 第二层：连接串密码检测 ----
    for m in _PATTERN_CONNSTR.finditer(text):
        password = m.group(2)
        if len(password) < 2 or password in seen_values:
            continue
        if password.startswith("{{secret:") or password.startswith("sec_live_") or password.startswith("sec_test_"):
            continue
        if password == "[REDACTED]" or password == "$SECRET":
            continue
        seen_values.add(password)
        matches.append(SensitiveMatch(
            secret_type="password",
            label="auto_connstr_password",
            value=password,
            value_start=m.start(2),
            value_end=m.end(2),
        ))"""

new_loop = """            # 过滤：太短、已是占位符、问询词、重复
            if len(value) < 2:
                continue
            if value.startswith("{{secret:") or value.startswith("sec_live_") or value.startswith("sec_test_"):
                continue
            if value == "[REDACTED]" or value == "$SECRET":
                continue
            if value.lower() in _SKIP_WORDS:
                continue
            if value in seen_values:
                continue
            seen_values.add(value)

            matches.append(SensitiveMatch(
                secret_type=rule.secret_type,
                label=rule.label,
                value=value,
                value_start=val_start,
                value_end=val_end,
            ))"""

content = content.replace(old_loop, new_loop)


# 4. Modify ReversibleSanitizeMiddleware.__init__
old_init = """    def __init__(
        self,
        save_record,  # Callable[[SecretRecord], None] — 同步金库写入回调
        encryption_key: bytes,
        user_id: str = "system",
        session_id: str = "",
        tenant_id: str = "default",
        allowed_tools: Optional[list[str]] = None,
        ttl_seconds: int = 900,
        max_reads: int = 999999,
    ):
        self._save_record = save_record
        self._encryption_key = encryption_key
        self._user_id = user_id
        self._session_id = session_id
        self._tenant_id = tenant_id
        self._allowed_tools = allowed_tools or ["secure_shell"]
        self._ttl_seconds = ttl_seconds
        self._max_reads = max_reads
        self._sanitize_count = 0  # 统计计数（不含敏感数据）"""

new_init = """    def __init__(
        self,
        save_record,  # Callable[[SecretRecord], None] — 同步金库写入回调
        encryption_key: bytes,
        load_rules: callable = None,
        user_id: str = "system",
        session_id: str = "",
        tenant_id: str = "default",
        allowed_tools: Optional[list[str]] = None,
        ttl_seconds: int = 900,
        max_reads: int = 999999,
    ):
        self._save_record = save_record
        self._encryption_key = encryption_key
        self._user_id = user_id
        self._session_id = session_id
        self._tenant_id = tenant_id
        self._allowed_tools = allowed_tools or ["secure_shell"]
        self._ttl_seconds = ttl_seconds
        self._max_reads = max_reads
        self._sanitize_count = 0  # 统计计数（不含敏感数据）
        
        # 加载并编译规则
        raw_rules = load_rules() if load_rules else []
        self.compiled_rules = []
        for r in raw_rules:
            try:
                r.compiled_pattern = re.compile(r.pattern)
                self.compiled_rules.append(r)
            except Exception as e:
                logger.error(f"规则 {r.name} 编译失败: {e}")"""

content = content.replace(old_init, new_init)

# 5. Modify before_model
old_before = """            for text in texts:
                all_matches.extend(detect_secrets_in_text(text))"""

new_before = """            for text in texts:
                all_matches.extend(detect_secrets_in_text(text, self.compiled_rules))"""

content = content.replace(old_before, new_before)

# 6. Add make_sync_load_rules at the end
sync_load = """

def make_sync_load_rules(redis_client, key_prefix="") -> callable:
    \"\"\"
    工厂函数：包装 RulesStore.list_rules 为同步回调，并自动执行 seed。
    \"\"\"
    import asyncio
    import concurrent.futures
    from blindvault_agent.security.rules_store import RulesStore
    
    is_fake = "Fake" in type(redis_client).__name__
    
    def load_rules_sync() -> list:
        def _load_in_new_loop_real():
            from redis.asyncio import Redis as AsyncRedis
            conn_pool = redis_client.connection_pool
            host = conn_pool.connection_kwargs.get("host", "localhost")
            port = conn_pool.connection_kwargs.get("port", 6379)
            db = conn_pool.connection_kwargs.get("db", 0)
            redis_url = f"redis://{host}:{port}/{db}"
            
            async def _task():
                temp_client = AsyncRedis.from_url(redis_url, decode_responses=True)
                temp_store = RulesStore(temp_client, key_prefix=key_prefix)
                try:
                    await temp_store.seed_builtin_rules_if_needed(_BUILTIN_RULES_DATA)
                    return await temp_store.list_rules()
                finally:
                    await temp_client.aclose()
            return asyncio.run(_task())
            
        def _load_in_new_loop_fake():
            temp_store = RulesStore(redis_client, key_prefix=key_prefix)
            async def _task():
                await temp_store.seed_builtin_rules_if_needed(_BUILTIN_RULES_DATA)
                return await temp_store.list_rules()
            return asyncio.run(_task())
            
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            
        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fn = _load_in_new_loop_fake if is_fake else _load_in_new_loop_real
                future = pool.submit(fn)
                return future.result(timeout=10)
        else:
            if is_fake:
                return _load_in_new_loop_fake()
            else:
                return _load_in_new_loop_real()
                
    return load_rules_sync
"""
content += sync_load

with open("blindvault_agent/middleware/reversible_sanitize.py", "w") as f:
    f.write(content)

