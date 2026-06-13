FROM python:3.12-slim

WORKDIR /app

# 0. 换 Debian + pip 为国内镜像源，避免境外网络卡顿
#    兼容新版 deb822 格式 (/etc/apt/sources.list.d/debian.sources) 和旧版 sources.list
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    if [ -f /etc/apt/sources.list ]; then \
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list; \
    fi; \
    pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# 1. 安装系统依赖，仅保留连接 PG 数据库和构建所需的最小依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    ca-certificates \
    curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
