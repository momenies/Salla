/**
 * بناء بيانات الفاتورة من طلب سلة.
 *
 * ⚠️ تنبيه مهم: هذه فاتورة/إيصال للعميل، وليست فاتورة ضريبية إلكترونية
 * معتمدة من هيئة الزكاة والضريبة والجمارك (ZATCA / فاتورة). الفوترة
 * الإلكترونية المعتمدة تتطلّب توقيعاً رقمياً وربطاً مع منصة فاتورة —
 * وهي مسؤولية نظام المتجر نفسه، لا هذا التطبيق.
 */

/** يقرأ مبلغاً من الأشكال المختلفة التي ترسلها سلة */
function amount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "object") return amount(value.amount);
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function currencyOf(order) {
  return (
    order?.total?.currency ||
    order?.amounts?.total?.currency ||
    order?.currency ||
    "SAR"
  );
}

/** رقم بصيغة مالية: 1,234.50 */
function money(value) {
  const n = amount(value);
  if (n === null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function customerName(customer) {
  if (!customer) return "عميل";
  const full = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return full || customer.name || "عميل";
}

/** التاريخ بصيغة عربية مقروءة */
function formatDate(value) {
  const raw = typeof value === "object" ? value?.date : value;
  if (!raw) return "—";
  const d = new Date(String(raw).replace(" ", "T").replace(/\.\d+$/, ""));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * يحوّل طلب سلة إلى بيانات جاهزة للطباعة.
 *
 * الأصناف: نحسب سعر الوحدة والإجمالي من الحقول المتاحة، ونتراجع إلى
 * القسمة على الكمية إن لم يصل سعر الوحدة صراحةً.
 */
function buildInvoice(order, store = {}, settings = {}) {
  const currency = currencyOf(order);
  const rawItems = Array.isArray(order?.items) ? order.items : [];

  const items = rawItems.map((item) => {
    const qty = Number.parseInt(item.quantity, 10) || 1;
    const lineTotal =
      amount(item?.amounts?.total) ?? amount(item?.total) ?? null;
    const unit =
      amount(item?.amounts?.price_without_tax) ??
      amount(item?.price) ??
      (lineTotal !== null ? lineTotal / qty : null);

    return {
      name: item.name || "منتج",
      sku: item.sku || "",
      quantity: qty,
      unit: money(unit),
      total: money(lineTotal !== null ? lineTotal : unit !== null ? unit * qty : null),
    };
  });

  // المجاميع: نأخذ ما ترسله سلة، ولا نخترع أرقاماً غير موجودة
  const subTotal = amount(order?.amounts?.sub_total);
  const shipping = amount(order?.amounts?.shipping_cost);
  const discount = amount(order?.amounts?.discount);
  const tax = amount(order?.amounts?.tax);
  const total = amount(order?.total) ?? amount(order?.amounts?.total);

  const totals = [];
  if (subTotal !== null) totals.push({ label: "المجموع قبل الشحن", value: money(subTotal) });
  if (discount !== null && discount > 0) totals.push({ label: "الخصم", value: "− " + money(discount) });
  if (shipping !== null) totals.push({ label: "الشحن", value: money(shipping) });
  if (tax !== null) totals.push({ label: "ضريبة القيمة المضافة", value: money(tax) });

  return {
    number: order?.reference_id || order?.id || "—",
    orderId: order?.id || null,
    date: formatDate(order?.date || order?.created_at),
    status: order?.status?.name || "",
    currency,

    store: {
      name: settings.store_name || store.name || "المتجر",
      domain: store.domain || "",
      avatar: store.avatar || "",
      taxNumber: settings.tax_number || "",
      commercialNumber: settings.commercial_number || "",
    },

    customer: {
      name: customerName(order?.customer),
      mobile: order?.customer?.mobile || "",
      email: order?.customer?.email || "",
      city: order?.customer?.city || "",
      address: order?.shipping?.address?.shipping_address || "",
    },

    items,
    totals,
    grandTotal: money(total),
    paymentMethod: order?.payment_method || "",
  };
}

module.exports = { buildInvoice, money, formatDate, customerName, amount };
