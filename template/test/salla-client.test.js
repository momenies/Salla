/** اختبارات عميل سلة: التجديد التلقائي للتوكن، ترجمة الأخطاء، وسحب كل الصفحات. */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.SALLA_OAUTH_CLIENT_ID = "test-id";
process.env.SALLA_OAUTH_CLIENT_SECRET = "test-secret";

/** خادم صغير يتحكّم فيه كل اختبار عبر `handler` */
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({ server, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** يعيد تحميل الوحدات بعد ضبط عناوين الخوادم الوهمية */
function loadClient(port) {
  process.env.SALLA_API_BASE = `http://127.0.0.1:${port}/admin/v2`;
  process.env.SALLA_ACCOUNTS_BASE = `http://127.0.0.1:${port}`;
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("../lib/salla")];
  return require("../lib/salla");
}

test("يجدّد التوكن تلقائياً عند 401 ويعيد المحاولة مرة واحدة", async () => {
  const calls = [];
  const ctx = await startServer((req, res) => {
    calls.push(req.url);
    res.setHeader("content-type", "application/json");
    if (req.url === "/oauth2/token") {
      return res.end(JSON.stringify({ access_token: "FRESH", refresh_token: "FRESH-R", expires_in: 100 }));
    }
    if (req.headers.authorization !== "Bearer FRESH") {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: "expired" } }));
    }
    res.end(JSON.stringify({ data: [{ id: 1 }], pagination: { totalPages: 1, currentPage: 1 } }));
  });

  const { SallaClient } = loadClient(ctx.port);
  let persisted = null;
  const client = new SallaClient({
    accessToken: "STALE",
    refreshToken: "R",
    onTokenRefresh: (tokens) => { persisted = tokens; },
  });

  const result = await client.listOrders({});
  assert.deepEqual(result.data, [{ id: 1 }]);
  assert.equal(client.accessToken, "FRESH");
  assert.equal(persisted.accessToken, "FRESH", "لا بد أن يُحفظ التوكن الجديد");
  assert.equal(calls.filter((u) => u === "/oauth2/token").length, 1, "تجديد واحد فقط");

  await ctx.close();
});

test("لا يعيد المحاولة إلى ما لا نهاية إن بقي الرد 401", async () => {
  let attempts = 0;
  const ctx = await startServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/oauth2/token") {
      return res.end(JSON.stringify({ access_token: "A", refresh_token: "B", expires_in: 10 }));
    }
    attempts++;
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: "still expired" } }));
  });

  const { SallaClient, SallaApiError } = loadClient(ctx.port);
  const client = new SallaClient({ accessToken: "X", refreshToken: "Y" });

  await assert.rejects(() => client.listOrders({}), SallaApiError);
  assert.equal(attempts, 2, "محاولة أصلية + إعادة واحدة فقط");

  await ctx.close();
});

test("يترجم أكواد الأخطاء إلى رسائل عربية", async () => {
  const codes = { 403: /صلاحية/, 404: /غير موجود/, 429: /الحد المسموح/, 500: /لا تستجيب/ };

  for (const [code, pattern] of Object.entries(codes)) {
    const ctx = await startServer((req, res) => {
      res.statusCode = Number(code);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "boom" } }));
    });

    const { SallaClient } = loadClient(ctx.port);
    const client = new SallaClient({ accessToken: "T" });

    await assert.rejects(
      () => client.listOrders({}),
      (err) => {
        assert.equal(err.status, Number(code));
        assert.match(err.message, pattern);
        return true;
      }
    );
    await ctx.close();
  }
});

test("fetchAll يمرّ على كل الصفحات ويتوقّف عند الأخيرة", async () => {
  const totalPages = 3;
  const ctx = await startServer((req, res) => {
    const page = Number(new URL(req.url, "http://x").searchParams.get("page")) || 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      data: [{ id: page * 10 }, { id: page * 10 + 1 }],
      pagination: { currentPage: page, totalPages },
    }));
  });

  const { SallaClient } = loadClient(ctx.port);
  const client = new SallaClient({ accessToken: "T" });

  const rows = await client.fetchAll((p) => client.listOrders(p));
  assert.equal(rows.length, totalPages * 2);
  assert.deepEqual(rows.map((r) => r.id), [10, 11, 20, 21, 30, 31]);

  await ctx.close();
});

test("fetchAll يتوقّف عند صفحة فارغة حتى بلا بيانات ترقيم", async () => {
  const ctx = await startServer((req, res) => {
    const page = Number(new URL(req.url, "http://x").searchParams.get("page")) || 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: page > 2 ? [] : [{ id: page }] }));
  });

  const { SallaClient } = loadClient(ctx.port);
  const client = new SallaClient({ accessToken: "T" });

  const rows = await client.fetchAll((p) => client.listCustomers(p));
  assert.equal(rows.length, 2);

  await ctx.close();
});
