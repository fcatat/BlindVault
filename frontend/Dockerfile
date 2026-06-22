# ---- build stage ----
FROM node:20-alpine AS build

# 是否使用国内镜像源加速构建（true=淘宝 npm 源）
ARG USE_CN_MIRROR=true

WORKDIR /app

RUN if [ "$USE_CN_MIRROR" = "true" ]; then \
        npm config set registry https://registry.npmmirror.com; \
    fi

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- serve stage ----
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
