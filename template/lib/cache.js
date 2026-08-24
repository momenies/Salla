/**
 * ذاكرة مؤقتة صغيرة في الذاكرة (TTL + إبطال يدوي).
 *
 * لماذا؟ لأن كل فتحة لصفحة كانت تنادي سلة من جديد — نداء شبكة كامل قبل أن
 * تظهر أول بكسل. النتيجة صفحات بطيئة وحدود استدعاء (rate limit) تقترب.
 * مع تخزين 60 ثانية تصبح الصفحة الثانية فورية، والبيانات ما زالت طازجة.
 *
 * ملاحظة تشغيلية: هذه ذاكرة داخل العملية الواحدة. عند تشغيل أكثر من نسخة
 * (Cloud Run) لكل نسخة ذاكرتها — وهذا مقبول لبيانات عرض قصيرة العمر.
 */
const DEFAULT_TTL = 60 * 1000;
const MAX_ENTRIES = 500;

const store = new Map();
/** نداءات جارية لنفس المفتاح — تمنع انفجار الطلبات المتزامنة (stampede) */
const inflight = new Map();

function now() {
  return Date.now();
}

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= now()) {
    store.set(key, undefined);
    store.delete(key);
    return undefined;
  }
  // LRU بسيط: إعادة الإدراج تجعله الأحدث
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

function set(key, value, ttl = DEFAULT_TTL) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: now() + ttl });
  return value;
}

/**
 * يُرجع القيمة المخزّنة أو ينفّذ `producer` ويخزّن نتيجته.
 * الطلبات المتزامنة على نفس المفتاح تنتظر نفس الوعد بدل تكرار النداء.
 */
async function remember(key, ttl, producer) {
  const cached = get(key);
  if (cached !== undefined) return cached;

  const running = inflight.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const value = await producer();
      // لا نخزّن الفراغ — حتى لا نثبّت فشلاً مؤقتاً لدقيقة كاملة
      if (value !== undefined && value !== null) set(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** يمسح مفتاحاً بعينه، أو كل ما يبدأ ببادئة (مثلاً كل بيانات متجر) */
function invalidate(prefix) {
  if (!prefix) return store.clear();
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(prefix)) store.delete(key);
  }
}

function stats() {
  return { entries: store.size, inflight: inflight.size };
}

module.exports = { get, set, remember, invalidate, stats, DEFAULT_TTL };
