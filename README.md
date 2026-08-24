# منقذ السلات — تطبيق سلة لاسترداد السلات المتروكة

تطبيق SaaS لمتاجر [سلة](https://salla.sa) يرسل تذكيراً تلقائياً على واتساب لكل عميل ترك سلته دون إتمام الطلب.

الكود كله في مجلد [`template/`](./template) — راجع [`template/README.md`](./template/README.md) للتشغيل والنشر والبنية.

```bash
cd template
npm install
cp .env.example .env    # املأ مفاتيح سلة
npm run dev             # http://localhost:8082
npm test                # الاختبارات
```
