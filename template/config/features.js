/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  كتالوج الميزات — الملف الوحيد الذي تعدّله عند إضافة ميزة جديدة
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * كل ميزة تُعرَّف مرة واحدة هنا، ويتكفّل باقي التطبيق بالباقي:
 *   • صفحة الباقات تعرضها تلقائياً (مفتوحة أو مقفلة)
 *   • القائمة الجانبية تضع قفلاً بجانبها إن لم تُشترَ
 *   • الحارس يمنع الدخول إليها
 *
 * ─── كيف تضيف ميزة مدفوعة جديدة؟ ───────────────────────────────────────────
 * ١. أضف عنصراً في FEATURES بالشكل التالي
 * ٢. في بوابة الشركاء: أنشئ Add-on بنفس السعر وانسخ معرّفه أو اسمه
 * ٣. ضع ذلك المعرّف/الاسم في `addonMatch`
 * ٤. خلاص — لا تعديل في أي ملف آخر
 *
 * ─── لماذا `addonMatch` مصفوفة نصوص؟ ───────────────────────────────────────
 * لأن سلة قد ترسل الإضافة باسمها أو بمعرّفها أو بـ slug. نطابق أي واحد منها،
 * فلا ينكسر الربط لو اختلف الشكل. وتقدر تشوف الشكل الحقيقي الذي وصلك من
 * صفحة الباقات ← "آخر رسالة اشتراك من سلة".
 */

const FEATURES = [
  // ─────────────────────────── الميزة الأساسية (مجانية) ───────────────────
  {
    key: "abandoned_carts",
    name: "أتمتة السلات المتروكة",
    description: "تذكير تلقائي لكل عميل ترك سلته دون إتمام الطلب، عبر واتساب.",
    icon: "cart",
    free: true, // متاحة للجميع بلا شراء — هذه واجهة التطبيق التي تجذب التجار
    routes: ["/abandoned", "/automations", "/settings"],
    price: null,
    addonMatch: [],
  },

  // ─────────────────────────── الميزات المدفوعة ───────────────────────────
  {
    key: "order_followups",
    name: "متابعة الطلبات تلقائياً",
    description: "رسائل تلقائية عند تأكيد الطلب وشحنه وتسليمه، بنصوص تكتبها أنت.",
    icon: "bag",
    free: false,
    routes: ["/orders"],
    price: "٢٩ ر.س / شهرياً",
    // ضع هنا اسم الإضافة أو معرّفها كما أنشأتها في بوابة الشركاء
    addonMatch: ["order_followups", "متابعة الطلبات"],
  },
  {
    key: "customers_crm",
    name: "إدارة العملاء",
    description: "قائمة عملائك مع إمكانية الإضافة اليدوية والتواصل المباشر.",
    icon: "users",
    free: false,
    routes: ["/customers"],
    price: "١٩ ر.س / شهرياً",
    addonMatch: ["customers_crm", "إدارة العملاء"],
  },

  {
    key: "invoices",
    name: "الفواتير",
    description: "فاتورة جاهزة للطباعة أو الحفظ PDF لكل طلب، بشعار متجرك وبياناته.",
    icon: "wallet",
    free: false,
    routes: ["/invoices"],
    price: "٢٥ ر.س / شهرياً",
    addonMatch: ["invoices", "الفواتير"],
  },

  // ➕ الميزات القادمة تُضاف هنا بنفس الشكل
];

/** خطة تفتح كل الميزات دفعة واحدة — أرخص للتاجر وأعلى دخلاً لك */
const BUNDLE = {
  key: "all_access",
  name: "الباقة الشاملة",
  description: "كل ميزات التطبيق الحالية والقادمة، بسعر واحد.",
  price: "٣٩ ر.س / شهرياً",
  addonMatch: ["all_access", "الباقة الشاملة", "bundle"],
};

/**
 * يفصل السعر إلى مبلغ ومدّة.
 *
 * السبب: "٢٩ ر.س / شهرياً" سطرٌ واحد طويل، فيلتف في منتصفه داخل البطاقة
 * ("٢٩ ر.س /" ثم "شهرياً") ويبدو مكسوراً. الفصل هنا — لا في القالب — يجعل
 * كل واجهة تعرضه بمستويين: المبلغ كبيراً والمدّة تحته خافتة.
 */
function splitPrice(price) {
  if (!price) return { amount: null, period: null };
  const [amount, ...rest] = String(price).split("/");
  return { amount: amount.trim(), period: rest.join("/").trim() || null };
}

for (const feature of [...FEATURES, BUNDLE]) {
  const { amount, period } = splitPrice(feature.price);
  feature.priceAmount = amount;
  feature.pricePeriod = period;
}

// ───────────────────────────── دوال مساعدة ─────────────────────────────────

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

function getFeature(key) {
  return BY_KEY.get(key) || null;
}

function freeKeys() {
  return FEATURES.filter((f) => f.free).map((f) => f.key);
}

function paidFeatures() {
  return FEATURES.filter((f) => !f.free);
}

/** المسار → مفتاح الميزة التي تحميه (أطول تطابق يفوز) */
function featureForRoute(pathname) {
  let best = null;
  for (const feature of FEATURES) {
    for (const route of feature.routes || []) {
      if (pathname === route || pathname.startsWith(route + "/")) {
        if (!best || route.length > best.matched.length) {
          best = { feature, matched: route };
        }
      }
    }
  }
  return best ? best.feature : null;
}

/**
 * يقرأ ما وصل من سلة ويستنتج أي الميزات يفتحها.
 *
 * نبحث في كل الحقول المحتملة لأن شكل رسالة الإضافات قد يختلف —
 * وإن لم نتعرّف على شيء نُرجع مصفوفة فارغة، ويبقى النص الخام محفوظاً
 * لتراه وتضبط `addonMatch` يدوياً.
 *
 * @returns {string[]} مفاتيح الميزات التي يجب فتحها
 */
function matchFeatures(payload) {
  const haystack = collectStrings(payload).map((s) => s.trim().toLowerCase());
  if (!haystack.length) return [];

  const hit = (candidates) =>
    (candidates || []).some((c) => haystack.includes(String(c).trim().toLowerCase()));

  // الباقة الشاملة تفتح كل شيء
  if (hit(BUNDLE.addonMatch)) return FEATURES.map((f) => f.key);

  return paidFeatures().filter((f) => hit(f.addonMatch)).map((f) => f.key);
}

/** يجمع القيم النصية والرقمية من الحقول التي تحمل عادةً اسم الخطة أو الإضافة */
function collectStrings(payload) {
  const out = [];
  const INTERESTING = /^(id|name|slug|key|code|type|plan|plan_name|plan_type|title|addon|add_on|feature)/i;

  const walk = (node, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object") {
        walk(value, depth + 1);
      } else if (INTERESTING.test(key)) {
        out.push(String(value));
      }
    }
  };

  walk(payload);
  return out;
}

module.exports = {
  FEATURES,
  splitPrice,
  BUNDLE,
  getFeature,
  freeKeys,
  paidFeatures,
  featureForRoute,
  matchFeatures,
  collectStrings,
};
