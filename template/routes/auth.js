/** مسارات الدخول والخروج عبر سلة. */
const express = require("express");
const { SallaAPI, passport } = require("../lib/auth");

const router = express.Router();

// يحوّل المستخدم إلى صفحة تسجيل الدخول في سلة
router.get(["/oauth/redirect", "/login"], passport.authenticate("salla"));

// سلة تعيد المستخدم إلى هنا بعد الموافقة
router.get(
  "/oauth/callback",
  passport.authenticate("salla", { failureRedirect: "/login?error=1" }),
  (req, res) => res.redirect("/")
);

router.get("/logout", (req, res, next) => {
  SallaAPI.logout();
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect("/"));
  });
});

module.exports = router;
