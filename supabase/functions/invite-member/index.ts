// invite-member: lets a workspace owner/admin invite someone (or add an existing user)
// with a role and per-space access. The service-role key stays on the server.
// Emails go out through GoHighLevel: we POST the invite to the workspace's GHL inbound webhook
// (set on the app's Settings page), and a GHL workflow sends the email.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const ALLOWED_REDIRECTS = [
  'https://techteam-oss.github.io/team-pm/',
  'http://localhost:5173/',
]
const ROLES = ['admin', 'member', 'guest'] as const
const ACCESS = ['view', 'comment', 'edit', 'full'] as const

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Body = {
  workspace_id: string
  email: string
  full_name?: string
  role: (typeof ROLES)[number]
  spaces?: { space_id: string; access: (typeof ACCESS)[number] }[]
  redirect_to?: string
  /** Send a fresh link to someone already in the workspace (no role or access changes). */
  resend?: boolean
}

// The webhook URL is set by an admin on the app's Settings page (workspace_settings); the
// GHL_EMAIL_WEBHOOK_URL secret is only a fallback.
async function notifyGhl(hook: string | null | undefined, payload: Record<string, string>): Promise<boolean> {
  hook = hook || Deno.env.get('GHL_EMAIL_WEBHOOK_URL')
  if (!hook) return false
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return r.ok
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Who is calling?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller?.user) return json({ error: 'Not signed in' }, 401)

  let body: Body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const email = (body.email ?? '').trim().toLowerCase()
  const spaces = body.spaces ?? []
  if (!body.workspace_id || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Workspace and a valid email are required' }, 400)
  if (!ROLES.includes(body.role)) return json({ error: 'Role must be admin, member or guest' }, 400)
  if (spaces.some((s) => !ACCESS.includes(s.access))) return json({ error: 'Invalid space access level' }, 400)

  // Only owners and admins of this workspace may invite.
  const { data: me } = await admin.from('workspace_members').select('role')
    .eq('workspace_id', body.workspace_id).eq('user_id', caller.user.id).maybeSingle()
  if (!me || !['owner', 'admin'].includes(me.role)) return json({ error: 'Only admins can add people' }, 403)

  // Spaces must belong to this workspace.
  if (spaces.length) {
    const ids = spaces.map((s) => s.space_id)
    const { data: found } = await admin.from('spaces').select('id').eq('workspace_id', body.workspace_id).in('id', ids)
    if ((found ?? []).length !== new Set(ids).size) return json({ error: 'One or more spaces are not in this workspace' }, 400)
  }

  const appUrl = ALLOWED_REDIRECTS.find((r) => body.redirect_to?.startsWith(r)) ?? ALLOWED_REDIRECTS[0]
  const { data: ws } = await admin.from('workspaces').select('name').eq('id', body.workspace_id).single()
  const { data: inviter } = await admin.from('profiles').select('full_name, email').eq('id', caller.user.id).single()
  const { data: settings } = await admin.from('workspace_settings').select('ghl_webhook_url').eq('workspace_id', body.workspace_id).maybeSingle()
  const who = inviter?.full_name || inviter?.email || 'Your admin'
  const wsName = ws?.name ?? ''

  // Resend: a new invite link if they never confirmed, otherwise a link to choose a new password.
  if (body.resend) {
    const { data: prof } = await admin.from('profiles').select('id, full_name').eq('email', email).maybeSingle()
    const { data: member } = prof
      ? await admin.from('workspace_members').select('role').eq('workspace_id', body.workspace_id).eq('user_id', prof.id).maybeSingle()
      : { data: null }
    if (!prof || !member) return json({ error: 'That person is not in this workspace' }, 404)
    const { data: u } = await admin.auth.admin.getUserById(prof.id)
    const kind = u?.user?.email_confirmed_at ? 'recovery' : 'invite'
    if (kind === 'invite') await admin.from('signup_allowlist').upsert({ email })
    const { data: fresh, error: freshErr } = kind === 'invite'
      ? await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: appUrl } })
      : await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: appUrl } })
    if (kind === 'invite') await admin.from('signup_allowlist').delete().eq('email', email)
    if (!fresh?.properties?.hashed_token) return json({ error: freshErr?.message ?? 'Could not create a new link' }, 400)
    const freshLink = `${appUrl}?token_hash=${fresh.properties.hashed_token}&type=${kind}`
    const name = prof.full_name || email.split('@')[0]
    const emailed = await notifyGhl(settings?.ghl_webhook_url, kind === 'invite'
      ? { event: 'invite', email, name, link: freshLink,
          subject: `Your new invite to ${wsName || 'the project tool'}`, heading: `Join ${wsName || 'your team'}`,
          message: `${who} sent you a fresh invite to ${wsName || 'the team'}'s project tool. Click the button to set your password and sign in. The link works once and expires in 1 hour.`,
          button_text: 'Accept invite', task: '', task_number: '', actor: who, workspace: wsName, invited_by: who, role: member.role }
      : { event: 'password_reset', email, name, link: freshLink,
          subject: 'Set a new password', heading: 'Set a new password',
          message: `${who} sent you a link to choose a new password for ${wsName || 'the project tool'}. The link works once and expires in 1 hour.`,
          button_text: 'Choose a new password', task: '', task_number: '', actor: who, workspace: wsName })
    return json({ ok: true, kind, emailed, invite_link: freshLink })
  }

  // Self sign-up is blocked in the database; only emails on this list can get a new account.
  await admin.from('signup_allowlist').upsert({ email })

  // Create the invite link ourselves (Supabase does not send any email) and hand it to GoHighLevel.
  let userId: string | undefined
  let inviteLink: string | null = null
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite', email, options: { redirectTo: appUrl, data: { full_name: body.full_name?.trim() || undefined } },
  })
  await admin.from('signup_allowlist').delete().eq('email', email) // only lingers if no account was created
  // The link opens the app directly and the app verifies the token, so it doesn't rely on
  // Supabase's Site URL / redirect settings.
  if (link?.user) { userId = link.user.id; inviteLink = `${appUrl}?token_hash=${link.properties.hashed_token}&type=invite` }
  else {
    const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
    if (!existing) return json({ error: linkErr?.message ?? 'Could not invite this email' }, 400)
    userId = existing.id
  }

  // Add to workspace without ever downgrading an owner.
  const { data: current } = await admin.from('workspace_members').select('role')
    .eq('workspace_id', body.workspace_id).eq('user_id', userId).maybeSingle()
  if (current?.role !== 'owner') {
    const { error } = await admin.from('workspace_members')
      .upsert({ workspace_id: body.workspace_id, user_id: userId, role: body.role })
    if (error) return json({ error: error.message }, 500)
  }

  if (spaces.length) {
    const { error } = await admin.from('space_members')
      .upsert(spaces.map((s) => ({ space_id: s.space_id, user_id: userId, access: s.access })))
    if (error) return json({ error: error.message }, 500)
  }

  let emailed = false
  if (inviteLink) {
    const name = body.full_name?.trim() || email.split('@')[0]
    emailed = await notifyGhl(settings?.ghl_webhook_url, {
      event: 'invite', email, name, link: inviteLink,
      subject: `${who} invited you to ${ws?.name ?? 'the project tool'}`,
      heading: `Join ${ws?.name ?? 'your team'}`,
      message: `${who} added you to ${ws?.name ?? 'the team'}'s project tool as ${body.role === 'admin' ? 'an admin' : `a ${body.role}`}. Click the button to set your password and sign in. The link works once and expires in 1 hour. If it has run out, ask your admin to press Resend invite.`,
      button_text: 'Accept invite', task: '', task_number: '', actor: who,
      workspace: ws?.name ?? '', invited_by: who, role: body.role,
    })
  }

  // The admin gets the link back too, so they can share it by hand if GoHighLevel is not set up yet.
  return json({ ok: true, user_id: userId, invited: !!inviteLink, emailed, invite_link: inviteLink })
})
