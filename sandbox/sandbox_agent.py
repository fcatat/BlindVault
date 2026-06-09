import asyncio
import os
import shutil
import logging
from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sandbox_agent")

app = FastAPI(title="BlindVault Sandbox Agent", version="1.2.0")

# 沙箱内存状态管理，支持手动升级
CURRENT_VERSION = "v1.2.0-tools"
UPGRADE_TARGET_VERSION = "v1.3.0-tools"

class ExecuteRequest(BaseModel):
    command: str

@app.get("/status")
async def get_status():
    """获取沙箱在线状态、版本号和可用工具。"""
    # 动态扫描系统中是否存在相关命令客户端
    all_cmds = [
        "ssh", "sshpass", "psql", "mysql", "redis-cli", 
        "kubectl", "ping", "nslookup", "telnet", "git", "curl"
    ]
    available_tools = []
    for cmd in all_cmds:
        if shutil.which(cmd):
            available_tools.append(cmd)
            
    return {
        "status": "healthy",
        "version": CURRENT_VERSION,
        "tools": available_tools,
        "env": "isolated-sandbox"
    }

@app.post("/execute")
async def execute_command(payload: ExecuteRequest):
    """在沙箱环境中安全且受限地执行命令，带有超时保护。"""
    cmd = payload.command
    logger.info("Executing command: %s", cmd[:100])
    
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            # 60秒超时保护
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=60.0
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.communicate()
            return {
                "stdout": "",
                "stderr": "Command execution timed out in isolated sandbox (60 seconds limit).",
                "exit_code": -1
            }
            
        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")
        
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": proc.returncode
        }
        
    except Exception as e:
        logger.exception("Error executing command in sandbox")
        return {
            "stdout": "",
            "stderr": f"Sandbox internal exception: {str(e)}",
            "exit_code": -1
        }

@app.post("/upgrade")
async def upgrade_sandbox():
    """模拟沙箱手动升级。"""
    global CURRENT_VERSION
    logger.info("Upgrading sandbox from %s to %s...", CURRENT_VERSION, UPGRADE_TARGET_VERSION)
    
    # 模拟网络拉取和重启延时
    await asyncio.sleep(2.0)
    
    CURRENT_VERSION = UPGRADE_TARGET_VERSION
    logger.info("Sandbox successfully upgraded to %s", CURRENT_VERSION)
    
    return {
        "status": "upgraded",
        "version": CURRENT_VERSION,
        "message": f"Diagnostics sandbox has been successfully upgraded to {CURRENT_VERSION}."
    }
