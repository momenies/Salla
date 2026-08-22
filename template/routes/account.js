/** بيانات الحساب وتجديد مفاتيح الاتصال. */
const express = require("express");
const { requireStore, asyncRoute } = require("../middleware");

const router = express.Router();

router.get(
  "/account",
  requireStore,
  (req, res) => {
  res.render("account.html", {
    page: "account",
    pageTitle: "بيانات الحساب",
    pageSubtitle: "معلوماتك ومعلومات متجرك على سلة",
    isLogin: req.user,
    user: req.user,
  });
});

router.get(
  "/refreshToken",
  requireStore,
  asyncRoute(async (req, res) => {
    const view = {
      page: "token",
      pageTitle: "تجديد التوكن",
      pageSubtitle: "مفاتيح الاتصال بين التطبيق ومتجرك",
      isLogin: req.user,
      user: req.user,
      token: null,
      error: null,
    };

    const tokens = req.merchantId ? await require("../services/db").stores()?.getTokens(req.merchantId) : null;
    if (!tokens || !tokens.refresh_token) {
      res.status(400);
      view.error = "لا يوجد refresh token محفوظ لهذا المتجر. سجّل الخروج ثم أعد الدخول.";
      return res.render("token.html", view);
    }

    try {
      const { refreshAccessToken } = require("../lib/salla");
      const fresh = await refreshAccessToken(tokens.refresh_token);
      await tokens.update({
        access_token: fresh.accessToken,
        refresh_token: fresh.refreshToken,
        expires_in: fresh.expiresIn || tokens.expires_in,
      });
      view.token = { accessToken: fresh.accessToken, newRefreshToken: fresh.refreshToken, expiresIn: fresh.expiresIn };
    } catch (err) {
      res.status(502);
      view.error = err.message;
    }

    res.render("token.html", view);
  })
);

module.exports = router;
