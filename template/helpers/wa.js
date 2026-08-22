// helpers/wa.js — WhatsApp Cloud API (Meta official) minimal client
const GRAPH = "https://graph.facebook.com/v21.0";

async function verifyNumber(token, phoneId) {
  try {
    const res = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true, phone: data.display_phone_number, name: data.verified_name, quality: data.quality_rating };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// params: array of strings replacing {{1}}, {{2}}, ... in the approved template body
async function sendTemplate(token, phoneId, to, templateName, params) {
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to).replace(/[^0-9]/g, ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: "ar" },
          components: [
            {
              type: "body",
              parameters: params.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    return { ok: true, id: data.messages && data.messages[0] && data.messages[0].id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { verifyNumber, sendTemplate };
