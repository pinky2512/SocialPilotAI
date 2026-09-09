// SendGrid email delivery (real sending).
//
// Concrete implementation of the ESP swap-in point in emailCampaignAgent.js.
// Config (env): SENDGRID_API_KEY, SENDGRID_FROM (a Single-Sender-verified
// address), optional SENDGRID_FROM_NAME. Without these, the agent falls back to
// the simulated send so the app stays runnable.

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

/** True when real sending is configured. */
export function isConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);
}

// Minimal plain-text → HTML so SendGrid can inject the open-tracking pixel and
// wrap links for click tracking (tracking only works on HTML content).
function toHtml(text) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,Arial,sans-serif;white-space:normal">${esc.replace(/\n/g, '<br>')}</div>`;
}

/**
 * Send one campaign to a list of recipients. Each recipient gets their own
 * message (separate personalizations) so addresses aren't exposed to each other.
 * Open/click tracking is enabled and the campaign id is attached as a custom arg,
 * so SendGrid's Event Webhook can report engagement back per campaign.
 * @param {object} p
 * @param {string[]} p.to           recipient email addresses
 * @param {string}   p.subject
 * @param {string}   p.body         plain-text body
 * @param {number}   [p.campaignId] tag echoed back on every webhook event
 * @returns {Promise<{messageId: string, recipients: number}>}
 */
export async function sendCampaign({ to, subject, body, campaignId = null }) {
  if (!isConfigured()) throw new Error('SendGrid is not configured (SENDGRID_API_KEY / SENDGRID_FROM)');
  if (!Array.isArray(to) || to.length === 0) throw new Error('no recipients to send to');

  const res = await fetch(SENDGRID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: to.map((email) => ({ to: [{ email }] })),
      from: { email: process.env.SENDGRID_FROM, name: process.env.SENDGRID_FROM_NAME || 'Social Pilot AI' },
      subject,
      // text/plain must come before text/html per the Mail Send API.
      content: [
        { type: 'text/plain', value: body },
        { type: 'text/html', value: toHtml(body) },
      ],
      tracking_settings: {
        open_tracking: { enable: true },
        click_tracking: { enable: true, enable_text: false },
      },
      ...(campaignId != null ? { custom_args: { campaign_id: String(campaignId) } } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`SendGrid error ${res.status}: ${t.slice(0, 200)}`);
  }
  return { messageId: res.headers.get('x-message-id') || 'sent', recipients: to.length };
}
