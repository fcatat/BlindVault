"""
BlindVault — FastAPI 入口

职责：
- 注册路由（secrets, agent, config）
- 注册中间件（CORS, 日志脱敏）
- 管理生命周期（Redis、PostgreSQL、工具注册）
- 配置日志系统
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.db import close_db, init_db, load_llm_config
from backend.redaction import RedactionLogFilter, RedactionMiddleware
from backend.redis_store import close_redis, get_store
from backend.tools.browser_login_mock import (
    BROWSER_LOGIN_MOCK_SCHEMA,
    browser_login_mock,
)
from backend.tools.registry import register_tool


def _setup_logging() -> None:
    """配置日志系统，添加脱敏过滤器。"""
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # 为所有 logger 添加脱敏过滤器
    root_logger = logging.getLogger()
    root_logger.addFilter(RedactionLogFilter())


def _register_tools() -> None:
    """注册所有可用工具。"""
    register_tool(
        name="browser_login_mock",
        description="模拟浏览器登录。密码通过 secret_ref 传入，不接受明文密码。",
        parameters=BROWSER_LOGIN_MOCK_SCHEMA,
        func=browser_login_mock,
    )

    # 注册 secure_shell 工具
    try:
        from backend.tools.secure_shell import (
            SECURE_SHELL_SCHEMA,
            secure_shell,
        )
        register_tool(
            name="secure_shell",
            description="通用安全 Shell 执行器。命令中用 $SECRET 占位，执行时自动替换为真实密码。支持 psql、ssh、curl、mysql 等任何命令。",
            parameters=SECURE_SHELL_SCHEMA,
            func=secure_shell,
        )
    except ImportError:
        logging.getLogger(__name__).warning("secure_shell 工具未就绪，跳过注册")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    _setup_logging()
    _register_tools()

    logger = logging.getLogger(__name__)
    logger.info("BlindVault 启动中...")

    settings = get_settings()

    # 初始化 PostgreSQL + 加载持久化配置
    try:
        await init_db(settings.database_url)
        persisted = await load_llm_config(settings.encryption_key_bytes)
        if persisted:
            for key, val in persisted.items():
                if val:  # 只覆盖非空值
                    setattr(settings, key, val)
            logger.info(
                "已从 PostgreSQL 加载持久化配置: provider=%s, model=%s, has_key=%s",
                settings.llm_provider,
                settings.llm_model,
                bool(settings.llm_api_key),
            )
    except Exception as e:
        logger.warning("PostgreSQL 连接失败，使用内存配置: %s", str(e))

    # 预热 Redis 连接
    try:
        store = await get_store()
        logger.info("Redis 连接成功")
    except Exception as e:
        logger.error("Redis 连接失败: %s", str(e))

    yield

    # 关闭资源
    logger.info("BlindVault 关闭中...")
    await close_redis()
    await close_db()


# ============================================================
# 创建 FastAPI 应用
# ============================================================

app = FastAPI(
    title="BlindVault",
    description="LLM Agent Secret Reference System — 让 secret 永远不进入 LLM prompt",
    version="0.2.0",
    lifespan=lifespan,
)

# ---- 中间件 ----

# CORS
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 日志脱敏
app.add_middleware(RedactionMiddleware)

# ---- 路由 ----

from backend.api.secrets import router as secrets_router
from backend.api.agent import router as agent_router
from backend.api.config import router as config_router

app.include_router(secrets_router)
app.include_router(agent_router)
app.include_router(config_router)


# ---- 健康检查 ----

@app.get("/health", tags=["system"])
async def health_check():
    """健康检查端点。"""
    return {"status": "ok", "service": "blindvault"}
