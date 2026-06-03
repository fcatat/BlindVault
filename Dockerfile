FROM python:3.12-slim

WORKDIR /app

# System deps & commonly used DevOps CLI clients
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    openssh-client \
    sshpass \
    postgresql-client \
    mariadb-client \
    redis-tools && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
