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
    let unmatched = null;
    let entitlements = [];
    try {
      open = [...(await activeFeatures(merchantId))];
      unmatched = await db.lastSubscriptionPayload(merchantId);
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
      unmatched,
    });
  })
);

module.exports = router;
