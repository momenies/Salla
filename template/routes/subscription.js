/** حالة اشتراك المتجر في التطبيق. */
const express = require("express");
const config = require("../config");
const { requireStore } = require("../middleware");
const { subscriptionLabel } = require("../lib/format");

const router = express.Router();

router.get(
  "/subscription",
  requireStore,
  (req, res) => {
  const status = req.store?.subscription_status || "none";
  res.render("subscription.html", {
    page: "subscription",
    pageTitle: "الاشتراك",
    pageSubtitle: "حالة اشتراك متجرك في التطبيق",
    isLogin: req.user,
    user: req.user,
    status,
    label: subscriptionLabel(status),
    active: req.store ? req.store.isSubscriptionActive() : false,
    appId: config.salla.appId,
    blocked: false,
  });
});

module.exports = router;
