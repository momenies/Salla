/** يجمع كل مسارات التطبيق في مكان واحد. */
const express = require("express");

const router = express.Router();

// مسارات لا تحتاج تسجيل دخول
router.use(require("./health"));
router.use(require("./webhook"));
router.use(require("./auth"));

// الأقسام
router.use(require("./dashboard"));
router.use(require("./orders"));
router.use(require("./customers"));
router.use(require("./products"));
router.use(require("./tools"));
router.use(require("./events"));
router.use(require("./settings"));
router.use(require("./subscription"));
router.use(require("./account"));

module.exports = router;
