/**
 * قائمة الأحداث التي يمكن بناء أتمتة عليها، وكيف نستخرج من كل حدث
 * المتغيّرات التي تُستخدم داخل نص الرسالة ورقم المستلم.
 *
 * إضافة حدث جديد = إضافة عنصر واحد هنا. لا شيء آخر يتغيّر.
 */

/** يجمع اسم العميل من الحقول المتفرّقة التي ترسلها سلة */
function customerName(customer) {
  if (!customer) return "";
  const full = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return full || customer.name || "";
}

function customerPhone(customer) {
  if (!customer) return "";
  return customer.mobile || customer.phone || "";
}

/** المتغيّرات المشتركة بين كل الأحداث */
function baseVars(body, store) {
  return {
    store_name: store?.name || "",
    store_domain: store?.domain || "",
    event: body?.event || "",
    date: new Date().toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "long", day: "numeric" }),
  };
}

function orderVars(data) {
  const customer = data?.customer || {};
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    customer_name: customerName(customer),
    order_id: data?.reference_id ?? data?.id ?? "",
    order_total: data?.total?.amount ?? data?.amounts?.total?.amount ?? "",
    order_currency: data?.total?.currency ?? "",
    order_status: data?.status?.name ?? "",
    items_count: items.length,
    items_list: items.map((i) => `${i.quantity}× ${i.name}`).join("، "),
    payment_method: data?.payment_method ?? "",
  };
}

/**
 * كل مُشغّل يعرّف:
 *  id          اسم حدث سلة
 *  label       الاسم بالعربية في الواجهة
 *  hint        متى يقع هذا الحدث
 *  audience    لمن تُرسل الرسالة (customer | merchant)
 *  recipient   من أين نأخذ رقم المستلم
 *  variables   المتغيّرات المتاحة في نص الرسالة
 *  sample      نص افتراضي جاهز
 */
const TRIGGERS = [
  {
    id: "order.created",
    label: "طلب جديد",
    hint: "بمجرّد أن يكمل العميل طلبه.",
    audience: "customer",
    recipient: (data) => customerPhone(data?.customer),
    variables: (body, store) => ({ ...baseVars(body, store), ...orderVars(body?.data) }),
    sample: "أهلاً {customer_name} 👋\nاستلمنا طلبك رقم {order_id} بقيمة {order_total} {order_currency}، وجارٍ تجهيزه.\nشكراً لثقتك بـ{store_name}.",
  },
  {
    id: "order.status.updated",
    label: "تغيّر حالة الطلب",
    hint: "كلما تغيّرت حالة أي طلب.",
    audience: "customer",
    recipient: (data) => customerPhone(data?.customer),
    variables: (body, store) => ({ ...baseVars(body, store), ...orderVars(body?.data) }),
    sample: "مرحباً {customer_name}، حالة طلبك رقم {order_id} صارت: {order_status}.",
  },
  {
    id: "order.shipment.created",
    label: "شحن الطلب",
    hint: "عند إنشاء شحنة للطلب.",
    audience: "customer",
    recipient: (data) => customerPhone(data?.customer),
    variables: (body, store) => ({
      ...baseVars(body, store),
      ...orderVars(body?.data?.order || body?.data),
      tracking_number: body?.data?.tracking_number || "",
      shipping_company: body?.data?.courier_name || body?.data?.company || "",
    }),
    sample: "طلبك رقم {order_id} في الطريق إليك 🚚\nشركة الشحن: {shipping_company}\nرقم التتبّع: {tracking_number}",
  },
  {
    id: "abandoned.cart",
    label: "سلة متروكة",
    hint: "عندما يترك العميل سلته دون إتمام الطلب.",
    audience: "customer",
    recipient: (data) => customerPhone(data?.customer),
    variables: (body, store) => ({
      ...baseVars(body, store),
      customer_name: customerName(body?.data?.customer),
      cart_total: body?.data?.total?.amount ?? "",
      cart_currency: body?.data?.total?.currency ?? "",
      cart_url: body?.data?.checkout_url || body?.data?.url || "",
    }),
    sample: "أهلاً {customer_name}، سلتك ما زالت محفوظة 🛒\nأكمل طلبك من هنا: {cart_url}",
  },
  {
    id: "customer.created",
    label: "عميل جديد",
    hint: "عند تسجيل عميل جديد في متجرك.",
    audience: "customer",
    recipient: (data) => customerPhone(data),
    variables: (body, store) => ({
      ...baseVars(body, store),
      customer_name: customerName(body?.data),
      customer_city: body?.data?.city || "",
    }),
    sample: "أهلاً {customer_name} 🌟\nسعداء بانضمامك إلى {store_name}. تصفّح جديدنا: {store_domain}",
  },
  {
    id: "product.quantity.low",
    label: "قرب نفاد كمية منتج",
    hint: "تنبيه لك أنت، لا للعميل.",
    audience: "merchant",
    recipient: () => "",
    variables: (body, store) => ({
      ...baseVars(body, store),
      product_name: body?.data?.name || "",
      product_sku: body?.data?.sku || "",
      quantity: body?.data?.quantity ?? "",
    }),
    sample: "⚠️ الكمية على وشك النفاد\nالمنتج: {product_name}\nالمتبقّي: {quantity}",
  },
  {
    id: "order.refunded",
    label: "استرجاع طلب",
    hint: "عند استرجاع مبلغ طلب.",
    audience: "customer",
    recipient: (data) => customerPhone(data?.customer),
    variables: (body, store) => ({ ...baseVars(body, store), ...orderVars(body?.data) }),
    sample: "تم استرجاع مبلغ طلبك رقم {order_id}. نعتذر عن أي إزعاج 🙏",
  },
];

const BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

function getTrigger(eventId) {
  return BY_ID.get(eventId) || null;
}

/** أسماء المتغيّرات المتاحة لحدث معيّن — لعرضها كأزرار في محرّر الرسالة */
function variableNamesFor(eventId) {
  const trigger = getTrigger(eventId);
  if (!trigger) return [];
  const sample = trigger.variables({ event: eventId, data: {} }, {});
  return Object.keys(sample);
}

module.exports = { TRIGGERS, getTrigger, variableNamesFor, customerName, customerPhone };
