/** فحص السلامة — تحتاجه منصّات الاستضافة مثل Cloud Run. */
const express = require("express");
const db = require("../services/db");
const config = require("../config");

const router = express.Router();
const startedAt = Date.now();

router.get("/healthz", async (req, res) => {
  const database = await db.ping();
  const status = database ? 200 : 503;
  res.status(status).json({
    ok: database,
    app: config.appName,
    env: config.env,
    database,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  });
});

module.exports = router;
