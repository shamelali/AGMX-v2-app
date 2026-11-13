// ============================================================
// AGMX Send Email Auth Hook (HTTP Edge Function)
// ============================================================
// Intercepts Supabase Auth emails (signup confirmations,
// password resets, magic links, email changes) and routes them
// through Resend.
//
// Configure in supabase/config.toml:
//   [auth.hook.send_email]
//   enabled = true
//   uri = "https://<project-ref>.supabase.co/functions/v1/send-email-hook"
//   secrets = "env(SEND_EMAIL_HOOK_SECRETS)"
//
// Set the secret in Supabase Dashboard → Edge Functions → Secrets:
//   SEND_EMAIL_HOOK_SECRETS=v1,whsec_<base64-secret>
//   RESEND_API_KEY=re_<your-resend-api-key>
//   SMTP_FROM=noreply@agmx.my
// ============================================================

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

interface SendEmailEvent {
  email: string           // Recipient address
  subject: string         // Email subject
  body: string            // HTML body
  instance_id: string     // Supabase instance ID
  event_id: string        // Unique event ID
  [key: string]: unknown
}

// ------------------------------------------------------------------
// Resend implementation
// ------------------------------------------------------------------
// Routes auth emails through Resend's API. Credentials must be set
// as Edge Function secrets in the Supabase Dashboard:
//
//   supabase secrets set RESEND_API_KEY=re_<your-resend-api-key>
//   supabase secrets set SMTP_FROM=noreply@agmx.my
//   supabase secrets set SEND_EMAIL_HOOK_SECRETS=v1,whsec_<base64-secret>
// ------------------------------------------------------------------

async function sendEmail(event: SendEmailEvent): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured')
  }

  const from = Deno.env.get('SMTP_FROM') || 'noreply@agmx.my'

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [event.email],
      subject: event.subject,
      html: event.body
    })
  })

  if (!resp.ok) {
    const errorText = await resp.text()
    throw new Error(`Resend returned ${resp.status}: ${errorText}`)
  }
}

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRETS')
  if (!hookSecret) {
    return new Response(
      JSON.stringify({ error: 'Send Email hook not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)

  try {
    // Verify Standard Webhooks signature
    const secret = hookSecret.replace('v1,whsec_', '')
    const wh = new Webhook(secret)
    const data = wh.verify(payload, headers) as SendEmailEvent

    // Send the email through Resend
    await sendEmail(data)

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Signature verification failure — not retry-able
    if (/signature|verification/i.test(message)) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Sending failure — retry-able (Supabase retries with 2s backoff, up to 3x)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'retry-after': 'true'
        }
      }
    )
  }
})