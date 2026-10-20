FROM node:22-alpine

WORKDIR /app

# 项目零第三方依赖，直接拷贝源码
COPY . .

ENV PORT=8090
EXPOSE 8090

# 静态页面 + /proxy 抓取代理
CMD ["node", "server.js"]
