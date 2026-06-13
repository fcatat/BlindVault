FROM node:20-alpine

WORKDIR /app

# 换 npm 为淘宝镜像，避免境外网络卡顿
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
