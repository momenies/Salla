/** صفحة الباقات — ما هو مفتوح، وما يمكن شراؤه */
const express = require("express");
const { asyncRoute, ensureAuthenticated, merchantOf } = require("../middleware");
const { FEATURES, BUNDLE, getFeature } = require("../config/features");
const { activeFeatures } = require("../helpers/subscriptions");
const db = require("../helpers/salla-db");
const env = require("../config/env");
const log = require("../lib/logger");

const router = express.Router();

router.get(
  "/plans",
  ensureAuthenticated,
  asyncRoute(async (req, res) => {
    const merchantId = merchantOf(req);
    let open = [];
    let unmatchedNotice = false;
    let entitlements = [];
    try {
      open = [...(await activeFeatures(merchantId))];
      // التاجر يستحق أن يعرف أن شراءه لم يُفعَّل — بلغته لا بلغتنا.
      // أما النص الخام فلا يُرسَل إلى القالب إطلاقاً: صفحة التاجر ليست
      // مكان بنيتنا الداخلية، وبوابة "إلا في الإنتاج" يكفي خطأ في
      // NODE_ENV ليسقطها. المطوّر يجد ما يحتاجه في سجل الخادم.
      unmatchedNotice = Boolean(await db.lastSubscriptionPayload(merchantId));
      // الجدول كان يعرض المفتاح البرمجي (customers_crm) للتاجر — نُرفق اسمه العربي
      entitlements = (await db.listEntitlements(merchantId)).map((row) => {
        const plain = row.toJSON();
        const feature = getFeature(plain.feature_key);
        return { ...plain, name: feature ? feature.name : null };
      });
    } catch (err) {
      log.warn("تعذّر تحميل الباقات", { error: err.message });
    }

    res.render("plans.html", {
      isLogin: req.user,
      user: req.user,
      features: FEATURES,
      bundle: BUNDLE,
      open,
      locked: null,
      entitlements: entitlements.filter((e) => e.feature_key !== "__unmatched__"),
      appId: env.salla.appId,
      unmatchedNotice,
      support: { email: env.supportEmail, whatsapp: env.supportWhatsapp },
    });
  })
);

module.exports = router;
