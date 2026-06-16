import re

with open("blindvault_agent/web.py", "r") as f:
    content = f.read()

# Models
models = """class RuleSuggestRequest(BaseModel):
    samples: list[str]
    description: str = ""

class RuleTestRequest(BaseModel):
    pattern: str
    capture_group: int = 1
    test_text: str

"""

content = content.replace("class RuleCreateRequest", models + "class RuleCreateRequest")

# Endpoints
endpoints = """
@app.post("/api/sanitize-rules/ai-suggest")
async def suggest_sanitize_rule(req: RuleSuggestRequest):
    \"\"\"AI 辅助生成脱敏规则\"\"\"
    settings = get_agent_settings()
    if not settings.litellm_api_key or settings.litellm_api_key == "PLACEHOLDER":
        raise HTTPException(status_code=500, detail="LLM API Key not configured")

    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage
    import json

    llm = ChatOpenAI(
        model=settings.default_model,
        base_url=settings.litellm_base_url,
        api_key=settings.litellm_api_key,
        temperature=0,
    )

    sys_prompt = \"\"\"You are a regular expression expert. Based on the user's samples and description, generate a Python regex to match the sensitive information.
Respond ONLY with a valid JSON object. Do NOT wrap it in markdown code blocks.
Required keys:
- "pattern": The regex string. Must be valid in Python's re module.
- "secret_type": String (e.g. "password", "api_key")
- "label": String (e.g. "auto_custom_rule")
- "capture_group": Integer (the exact group index to redact. 0 for full match)
- "explanation": Brief explanation of how the regex works.
\"\"\"
    user_msg = f"Samples:\\n{json.dumps(req.samples)}\\n\\nDescription:\\n{req.description}"

    try:
        response = await llm.ainvoke([
            SystemMessage(content=sys_prompt),
            HumanMessage(content=user_msg)
        ])
        
        # Clean up possible markdown wrappers
        text = response.content.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        result = json.loads(text)
        pattern = result.get("pattern", "")
        if not pattern:
            raise ValueError("Missing 'pattern' in AI response")
            
        re.compile(pattern)
        
        result["is_candidate"] = True
        return result
        
    except json.JSONDecodeError:
        logger.error("AI 响应不是合法的 JSON: %s", response.content)
        raise HTTPException(status_code=500, detail="AI response is not valid JSON")
    except re.error as e:
        logger.error("AI 生成的正则不合法: %s", e)
        raise HTTPException(status_code=400, detail=f"AI generated invalid regex: {e}")
    except Exception as e:
        logger.error("AI Suggestion Failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

import asyncio
import concurrent.futures

_test_regex_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)

def _run_regex_test(pattern: str, group_idx: int, text: str):
    import re
    pat = re.compile(pattern, re.IGNORECASE)
    matches = []
    for m in pat.finditer(text):
        try:
            value = m.group(group_idx).strip()
            val_start = m.start(group_idx)
            val_end = m.end(group_idx)
        except IndexError:
            value = m.group(0).strip()
            val_start = m.start(0)
            val_end = m.end(0)
        
        if len(value) < 2:
            continue
            
        matches.append({
            "value": value,
            "start": val_start,
            "end": val_end
        })
    return matches

@app.post("/api/sanitize-rules/test")
async def test_sanitize_rule(req: RuleTestRequest):
    \"\"\"测试单条规则（防 ReDoS，带 100ms 超时）\"\"\"
    if len(req.pattern) > 500:
        raise HTTPException(status_code=400, detail="Pattern length exceeds 500 characters")
        
    try:
        re.compile(req.pattern)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {e}")
        
    loop = asyncio.get_running_loop()
    try:
        matches = await asyncio.wait_for(
            loop.run_in_executor(_test_regex_pool, _run_regex_test, req.pattern, req.capture_group, req.test_text),
            timeout=0.1
        )
        return {"matches": matches}
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="Regex matching timed out (possible ReDoS)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

"""

content = content.replace("from blindvault_agent.config import get_agent_settings", endpoints + "\nfrom blindvault_agent.config import get_agent_settings")

with open("blindvault_agent/web.py", "w") as f:
    f.write(content)

