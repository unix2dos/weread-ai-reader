FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=19763

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server

EXPOSE 19763

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 19763) + '/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["npm", "start"]
