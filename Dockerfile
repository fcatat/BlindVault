FROM python:3.12-slim

WORKDIR /app

# 1. 安装系统依赖、网络与 DNS 诊断、常用数据库及 DevOps 客户端
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    ca-certificates \
    curl \
    wget \
    git \
    rsync \
    openssh-client \
    sshpass \
    postgresql-client \
    mariadb-client \
    redis-tools \
    sqlite3 \
    iputils-ping \
    dnsutils \
    net-tools \
    telnet \
    procps \
    htop \
    jq \
    zip \
    unzip && \
    rm -rf /var/lib/apt/lists/*

# 2. 安装 Kubernetes 命令行工具 kubectl (提供云原生集群管理支持)
RUN curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/v1.30.0/bin/linux/amd64/kubectl" && \
    chmod +x /usr/local/bin/kubectl

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
