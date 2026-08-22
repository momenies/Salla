# صورة جاهزة للنشر على Google Cloud Run أو أي منصّة حاويات.
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
# sqlite3 يحتاج أدوات بناء إن لم تتوفّر نسخة جاهزة لهذه المعمارية
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && npm ci --omit=dev \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# لا نعمل بصلاحيات الجذر داخل الحاوية
RUN chown -R node:node /app
USER node

# Cloud Run يمرّر المنفذ عبر متغيّر PORT
ENV PORT=8080
EXPOSE 8080

CMD ["node", "app.js"]
