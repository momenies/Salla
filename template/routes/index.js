/** تجميع كل المسارات في راوتر واحد — ترتيبها هنا هو ترتيب المطابقة */
const express = require("express");

const router = express.Router();

router.use(require("./internal"));   // الصحة والمجدول — قبل أي حارس
router.use(require("./webhook"));    // أحداث سلة
router.use(require("./auth"));       // الدخول والخروج
router.use(require("./dashboard"));  // "/" و /api/stats
router.use(require("./abandoned"));
router.use(require("./automations"));
router.use(require("./settings"));
router.use(require("./store"));      // الطلبات، العملاء، الفواتير، الحساب
router.use(require("./plans"));
router.use(require("./wa"));

module.exports = router;
