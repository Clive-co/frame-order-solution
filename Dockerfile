FROM node:22-slim
WORKDIR /app
COPY package.json order.js ./
COPY src ./src
CMD ["node", "order.js", "/frames"]
