# AGENTS.md

## حالة المشروع

- الهدف: بناء عدة تطبيقات صغيرة مدفوعة باشتراك لنشرها على متجر تطبيقات سلة (Salla App Store)، بإعادة استخدام قالب واحد.
- `template/` هو القالب الأساسي: نسخة معدلة من قالب سلة الرسمي `SallaApp/express-starter-kit` (Node.js + Express). أحداث الـ webhooks في `template/Actions/`.
- **تم اختبار تدفق تسجيل الدخول OAuth كاملاً وهو يعمل** (متجر تجريبي في بوابة الشركاء). تعديلاتنا على القالب الرسمي (لا تُفقد عند التحديث):
  - `express` مثبت على `4.21.2` (الإصدار 5 يكسر `setExpressVerify` في مكتبة سلة).
  - قاعدة البيانات: SQLite محلية عبر متغير `DATABASE_STORAGE=database.sqlite` في `.env` (بدل MySQL) — للإنتاج لاحقاً نستبدلها.
  - إصلاح خطأين في `database/index.js` (saveOauth كانت تبحث بـ email غير موجود، retrieveUser لم تكن تجلب التوكن) وحماية مسار `/` في `app.js` من الانهيار.
- يتطلب Node >= 20.19 (المثبت على الجهاز: v24). تشغيل محلي: `npm install` ثم `npm run dev` داخل `template/`.
- مفاتيح التطبيق الحقيقية (Client ID/Secret) موجودة في `template/.env` — الملف مستثنى من Git عبر `.gitignore`، لا ترفعه أبداً ولا تطبعه في اللوج.
- Webhook Secret و App ID ما زالا غير مضبوطين في `.env` (مطلوبان لأحداث المتجر لاحقاً).
- النشر المخطط: Google Cloud Run (لدى المستخدم رصيد GCP). عند النشر يتغير Callback URL في البوابة إلى الرابط العام.
- المستودع Git جاهز: الفرع `main`، والجهاز البعيد `origin` هو `https://github.com/momenies/opencode.git`.

## مشروع reels-engine (منصة قص الفيديو) — محذوف محلياً!

- **`C:\reels-app` حُذف بالكامل بطلب المستخدم (2026-08-23)** بعد رفع الكود إلى GitHub. لم يبقَ محلياً شيء.
- **الكود موجود على**: `github.com/momenies/opencode` فرع **`reels-app`** (61 ملفاً: web + engine مدمج).
- **غير المرفوع وضاع مع الحذف**: قاعدة البيانات (حسابات admin@zonexin.com وtest@reels.local)، كل الفيديوهات والمقاطع في storage/، `web/.env` (SESSION_SECRET ومفاتيح Google الفارغة)، وvenv. ذاكرة whisper نجت في `%USERPROFILE%\.cache\huggingface`.
- **خطوات الاستعادة عند الحاجة**: `git clone -b reels-app https://github.com/momenies/opencode.git C:\reels-app` → `npm install` في web/ → بايثون 3.12 + venv + `pip install -r engine/requirements.txt` → `python scripts/fetch_fonts.py` داخل engine → إنشاء `.env` جديد (SESSION_SECRET، PORT=3000، DEMO_PUBLISH=1) → `node server.js`. المفاتيح السرية القديمة غير موجودة أصلاً (Anthropic ضاع سابقاً، Google لم تُدخل بعد).
- البنية كانت: `engine` (محرك بايثون) و`web` (SaaS بـ Express+EJS+better-sqlite3) — التفاصيل التقنية أدناه صالحة للاستعادة.
- إصلاحاتنا على المحرك موجودة الآن في الفرع المرفوع نفسه (render/run/score patches).
- **Git**: `C:\reels-app` مستودع مستقل الآن؛ يُدفع كفرع `reels-app` على `github.com/momenies/opencode` (`git push origin main:reels-app`) — فرع `main` البعيد لم يُمس. `.gitignore` يستثني .env وdata.sqlite وstorage وvenv وnode_modules وخطوط assets/fonts (تستعاد بـ scripts/fetch_fonts.py). حذفنا `engine\.git` الداخلي حتى تُتتبع تعديلاتنا مباشرة.
- البنية: `C:\reels-app\engine` (محرك بايثون المستنسخ من momenies/reels-engine + `.venv` بايثون 3.12) و `C:\reels-app\web` (طبقة SaaS بـ Express+EJS+better-sqlite3).
- تشغيل الموقع: `node server.js` داخل `C:\reels-app\web` (منفذ 3000). حساب تجريبي: test@reels.local / secret123.
- إصلاحاتنا على المحرك (أعد تطبيقها إذا استُنسخ من جديد): `render.py::_esc` مسارات نسبية ASCII لـ ffmpeg≥7؛ `run.py` ترميز UTF-8 + slug آمن + `--no-ai` + تراجع تلقائي عند فشل Claude؛ `score.py::find_clips_basic` اختيار بديل بدون API.
- العامل worker.js يكتشف أخطاء رصيد Anthropic ويتحول تلقائياً لوضع --no-ai، ويظهر تقدم الترميز الحي بالعربية (يتطلب PYTHONUNBUFFERED=1).
- رصيد Anthropic صفر — الاختيار الذكي معطل حتى يشحن المستخدم رصيداً، والمفتاح الكامل غير موجود بعد المسح (اطلبه من المستخدم عند الحاجة ولا تطبعه).
- ذاكرة whisper (tiny/small) في `%USERPROFILE%\.cache\huggingface` خارج المشروع — نجت من النقلة.
- المهمة #2 (فيديو عربي) اكتملت بنجاح: 5 مقاطع بعناوين عربية في storage/jobs/2.
- **إصلاح yt-dlp بعد النقلة**: ملفات `.exe` في `venv\Scripts` تحتوي مسار بايثون القديم المضمّن — تنكسر صامتة عند نقل venv. الحل الدائم: worker يستدعي `[PY, '-m', 'yt_dlp', ...]` بدل الـ wrapper. تحذير yt-dlp الجديد: ينصح بـ JS runtime (deno) لاستخراج يوتيوب — يعمل بدونه حالياً عبر player API.
- **توافق Ssemble API مكتمل (2026-08-23)** — الأداة التسعة كمسارات REST محمية بجلسة المستخدم: `POST /jobs` (يوتيوب أو رابط mp4 مباشر + webhook_url اختياري)، `GET /api/jobs/:id/status` (نسبة مئوية + مرحلة)، `GET /api/jobs/:id/shorts` (مقاطع + روابط + درجات)، `GET /api/requests?status=&page=&limit=`، `DELETE /api/jobs/:id` (يحذف الملفات والصفوف ويرفض أثناء المعالجة 409)، `GET /api/templates|music|game-videos|meme-hooks`. أعمدة جديدة: jobs.webhook_url, jobs.pct. الويبهوك يطلق job.completed/job.failed مع مصفوفة clips. القوالب الأربعة معرفة لكن تطبيقها على المحرك لاحق؛ music/games/memes تعيد قوائم فارغة بانتظار أصول مرخصة.
- زر 🗑️ حذف في لوحة التحكم + نسبة مئوية حية. اختبارات API: test-api.js / test-api2.js / test-api3.js (الثالث يثبت المسار الكامل: إنشاء من رابط محلي + ويبهوك + حذف). أصل تجريبي محلي: public/media/2.mp4 (نسخة الفيديو العربي لاختبار الروابط المباشرة).
- حساب المستخدم الحقيقي: admin@zonexin.com (user_id=2) — مهامه 2,3,4,5,11,12,13 (13 أوقفها بناءً على طلبه أثناء المعالجة).
- النسخ الاحتياطية القديمة حُذفت كلها بطلب المستخدم (2026-08-23): `reels-app-BACKUP-Dropbox` والمجلد المتداخل `Opencode/` — لا شيء محلي للمشروع سوى ما هو على فرع `reels-app` في GitHub.

## بيئة المستخدم (مهم جداً)

- **المستخدم مبتدئ تماماً ويتواصل بالعربية** — اشرح بخطوات بسيطة ومجزأة، وتجنّب المصطلحات التقنية أو اشرحها.
- نظام التشغيل: Windows مع PowerShell 5.1.
- المستخدم يعمل عبر **تطبيق OpenCode Desktop** فقط؛ أمر `opencode` غير متوفر في PowerShell.

## ملاحظات تقنية

- تم تثبيت Git 2.55 في `C:\Program Files\Git\cmd\git.exe` لكنه قد لا يظهر في نافذة PowerShell فُتحت قبل التثبيت — استخدم المسار الكامل.
- **لا تضع مشاريع بناء داخل Dropbox** — سبب مسح ملفات فعلي هنا. استخدم `C:\` مباشرة.
- **تحذير ترميز**: `Get-Content | Set-Content` في PS 5.1 يفسد النص العربي UTF-8 إلى mojibake — عدّل ملفات JS العربية بأداة Edit/Write فقط.
- العمليات الخلفية: أطلقها عبر WMI (`Win32_Process.Create`) مع إعادة توجيه اللوج لملف؛ انقطاعات أداة الطرفية قد تقتل الأبناء وتترك عمليات يتيمة (افحص `Get-Process python` قبل التشغيل الجديد).
- أوامر `node -e "..."` مع SQL عربي تفشل اقتباساً في PS 5.1 — اكتب سكربت .js مؤقت ونفذه.
