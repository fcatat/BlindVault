import logging
import httpx

logger = logging.getLogger(__name__)

def make_sandbox_executor(sandbox_url: str):
    if not sandbox_url:
        async def fail_closed(command: str) -> dict:
            return {
                "stdout": "",
                "stderr": "BLINDVAULT_SANDBOX_URL 未配置，拒绝执行（fail-closed）",
                "exit_code": -1
            }
        return fail_closed

    async def sandbox_http_executor(command: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=65.0) as client:
                response = await client.post(
                    f"{sandbox_url}/execute",
                    json={"command": command}
                )
                response.raise_for_status()
                return response.json()
        except httpx.TimeoutException:
            logger.error("Sandbox execution timeout (65s).")
            return {
                "stdout": "",
                "stderr": "沙箱执行超时（65s）",
                "exit_code": -1
            }
        except httpx.HTTPError as e:
            error_name = e.__class__.__name__
            logger.error("Sandbox HTTP Error: %s", error_name)
            return {
                "stdout": "",
                "stderr": f"沙箱不可达: {error_name}",
                "exit_code": -1
            }
        except Exception as e:
            error_name = e.__class__.__name__
            logger.error("Sandbox Unknown Error: %s", error_name)
            return {
                "stdout": "",
                "stderr": f"沙箱不可达: {error_name}",
                "exit_code": -1
            }

    return sandbox_http_executor
