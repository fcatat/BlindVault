import re

with open("blindvault_agent/tests/test_reversible_sanitize.py", "r") as f:
    content = f.read()

# 1. Add mock load_rules
mock_rules_code = """
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

"""

content = content.replace("from blindvault_agent.middleware.reversible_sanitize import (\n    ReversibleSanitizeMiddleware,\n    detect_secrets_in_text,\n)",
"from blindvault_agent.middleware.reversible_sanitize import (\n    ReversibleSanitizeMiddleware,\n    detect_secrets_in_text,\n)" + mock_rules_code)

# 2. Update middleware fixture
old_fixture = """@pytest.fixture
def middleware(vault):
    return ReversibleSanitizeMiddleware(
        save_record=vault.save_record,
        encryption_key=TEST_KEY_RAW,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
    )"""

new_fixture = """@pytest.fixture
def middleware(vault):
    return ReversibleSanitizeMiddleware(
        save_record=vault.save_record,
        encryption_key=TEST_KEY_RAW,
        load_rules=mock_load_rules,
        user_id="test_user",
        session_id="test_session",
        tenant_id="default",
    )"""

content = content.replace(old_fixture, new_fixture)

# 3. Update test_middleware_vault_failure_blocks
old_mw = """    mw = ReversibleSanitizeMiddleware(
        save_record=failing_save,
        encryption_key=TEST_KEY_RAW,
    )"""

new_mw = """    mw = ReversibleSanitizeMiddleware(
        save_record=failing_save,
        encryption_key=TEST_KEY_RAW,
        load_rules=mock_load_rules,
    )"""

content = content.replace(old_mw, new_mw)

# 4. Update detect_secrets_in_text calls
content = content.replace("detect_secrets_in_text(", "detect_secrets_in_text(")
# Wait, I can just replace detect_secrets_in_text(text) with detect_secrets_in_text(text, _TEST_RULES)
content = re.sub(r'detect_secrets_in_text\(([^,)]+)\)', r'detect_secrets_in_text(\1, _TEST_RULES)', content)

with open("blindvault_agent/tests/test_reversible_sanitize.py", "w") as f:
    f.write(content)
