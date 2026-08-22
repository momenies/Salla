/**
 * توحيد شكل البيانات القادمة من سلة.
 * سلة ترجع بيانات المتجر تحت `merchant` أحياناً وتحت `store` أحياناً أخرى،
 * فنوحّدها هنا مرة واحدة بدل تكرار الفحص في كل قالب.
 */

function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.id ?? null,
    name: raw.name ?? null,
    username: raw.username ?? null,
    domain: raw.domain ?? null,
    avatar: raw.avatar ?? null,
    email: raw.email ?? null,
    mobile: raw.mobile ?? null,
    plan: raw.plan ?? null,
    status: raw.status ?? null,
    created_at: raw.created_at ?? null,
    raw,
  };
}

/** يحوّل ملف المستخدم القادم من /oauth2/user/info إلى شكل ثابت */
function normalizeUser(profile) {
  if (!profile || typeof profile !== "object") return null;
  return {
    id: profile.id ?? null,
    name: profile.name ?? null,
    email: profile.email ?? null,
    mobile: profile.mobile ?? null,
    role: profile.role ?? null,
    store: normalizeStore(profile.merchant || profile.store),
    raw: profile,
  };
}

/** معرّف المتجر من ملف المستخدم، مهما كان شكل الرد */
function merchantIdOf(profile) {
  return profile?.merchant?.id ?? profile?.store?.id ?? profile?.merchant ?? null;
}

/**
 * يوحّد كائن ترقيم الصفحات القادم من سلة (تتغيّر أسماء الحقول بين المسارات)
 * ويضيف ما تحتاجه الواجهة لرسم أزرار التنقّل.
 */
function normalizePagination(raw, { page = 1, perPage = 15, itemsOnPage = 0 } = {}) {
  const currentPage = Number(raw?.currentPage ?? raw?.current_page ?? page) || 1;
  const totalPages = Number(raw?.totalPages ?? raw?.total_pages ?? 0) || (itemsOnPage < perPage ? currentPage : currentPage + 1);
  const total = Number(raw?.total ?? raw?.count ?? 0) || null;

  return {
    page: currentPage,
    perPage: Number(raw?.perPage ?? raw?.per_page ?? perPage) || perPage,
    totalPages: Math.max(1, totalPages),
    total,
    hasPrev: currentPage > 1,
    hasNext: currentPage < Math.max(1, totalPages),
    prevPage: Math.max(1, currentPage - 1),
    nextPage: currentPage + 1,
  };
}

module.exports = { normalizeUser, normalizeStore, merchantIdOf, normalizePagination };
