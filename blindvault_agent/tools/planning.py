from langchain_core.tools import tool

@tool
def record_plan(steps: list[str]) -> str:
    """当接收到需要多步执行的复杂运维任务时，在执行任何实际操作（如 secure_shell）之前，必须首先调用此工具记录执行计划。
    
    Args:
        steps: 计划执行的步骤描述列表。注意：如果步骤描述中涉及密码或凭证，必须使用占位符（如 $SECRET 或 {{secret:xxx}}），绝对不要写入明文密码。
    """
    return f"计划已记录（共 {len(steps)} 步）。请开始严格按照计划的步骤，逐步调用 secure_shell 等工具执行。"
