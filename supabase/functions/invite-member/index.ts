// invite-member: lets a workspace owner/admin invite someone (or add an existing user)
// with a role and per-space access. The service-role key stays on the server.
// Emails go out through GoHighLevel: we POST the invite link to the GHL inbound webhook
// in the GHL_EMAIL_WEBHOOK_URL secret, and a GHL workflow sends the email.
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
}

async function notifyGhl(payload: Record<string, string>): Promise<boolean> {
  const hook = Deno.env.get('GHL_EMAIL_WEBHOOK_URL')
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

  const redirectTo = ALLOWED_REDIRECTS.find((r) => body.redirect_to?.startsWith(r)) ?? ALLOWED_REDIRECTS[0]

  // Create the invite link ourselves (Supabase does not send any email) and hand it to GoHighLevel.
  let userId: string | undefined
  let inviteLink: string | null = null
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite', email, options: { redirectTo, data: { full_name: body.full_name?.trim() || undefined } },
  })
  if (link?.user) { userId = link.user.id; inviteLink = link.properties.action_link }
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
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', body.workspace_id).single()
    const { data: inviter } = await admin.from('profiles').select('full_name, email').eq('id', caller.user.id).single()
    emailed = await notifyGhl({
      event: 'invite', email, name: body.full_name?.trim() || email.split('@')[0], link: inviteLink,
      workspace: ws?.name ?? '', invited_by: inviter?.full_name || inviter?.email || '', role: body.role,
    })
  }

  // The admin gets the link back too, so they can share it by hand if GoHighLevel is not set up yet.
  return json({ ok: true, user_id: userId, invited: !!inviteLink, emailed, invite_link: inviteLink })
})
