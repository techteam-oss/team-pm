// password-reset: creates a recovery link and hands it to GoHighLevel to email.
// Public (no login needed). Always answers the same way so it can't be used to check which emails exist.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const REDIRECT = 'https://techteam-oss.github.io/team-pm/'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const ok = () => new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: cors })
  let email = ''
  try { email = String((await req.json()).email ?? '').trim().toLowerCase() } catch { return ok() }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ok()

  const hook = Deno.env.get('GHL_EMAIL_WEBHOOK_URL')
  if (!hook) return ok()
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Only people who already have a profile (were invited) can get a reset link.
  const { data: profile } = await admin.from('profiles').select('full_name').eq('email', email).maybeSingle()
  if (!profile) return ok()

  const { data } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: REDIRECT } })
  if (data?.properties?.action_link) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'password_reset', email, name: profile.full_name || email.split('@')[0], link: data.properties.action_link }) })
    } catch { /* ignore */ }
  }
  return ok()
})
