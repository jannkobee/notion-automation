FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Manila

COPY package*.json ./
RUN npm ci --omit=dev

COPY standup.mjs scheduler.mjs ./

USER node
CMD ["node", "scheduler.mjs"]
