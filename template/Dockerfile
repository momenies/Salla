# ═══════════════════════════════════════════════════════════════════════════
#  صورة إنتاج لمنقذ السلات — جاهزة لـ Google Cloud Run أو أي منصّة حاويات
# ═══════════════════════════════════════════════════════════════════════════
#  بناء على مرحلتين: مرحلة تُثبّت الاعتماديات بأدوات البناء، ومرحلة نهائية
#  لا تحمل تلك الأدوات — أصغر حجماً وأقل سطح هجوم.

FROM node:22-slim AS deps
WORKDIR /app

# قناة الباركود تحتاج Chromium (~400MB). الإنتاج يستخدم قناة Meta الرسمية،
# فنمنع تنزيله. لتفعيل الباركود: احذف هذين السطرين وثبّت chromium في المرحلة النهائية.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && npm ci --omit=dev --no-audit --no-fund \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Cloud Run يوجّه الطلبات عبر وسيط، وهذا يجعل كوكي الجلسة الآمنة تعمل
ENV TRUST_PROXY=1
# المؤقّت الداخلي لا يُعتمد عليه على منصّة تُطفئ النسخ عند الخمول؛
# اضبط Cloud Scheduler على /internal/cron بدلاً منه.
ENV DISABLE_INTERNAL_TICKER=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# لا نعمل بصلاحيات الجذر داخل الحاوية
USER node

EXPOSE 8080

# المنصّة تحتاج إشارة صحّة صادقة لتعرف متى تعيد التشغيل
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "app.js"]
