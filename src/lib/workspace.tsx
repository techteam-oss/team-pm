import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { applyTheme, type Theme } from './theme'

export type Role = 'owner' | 'admin' | 'member' | 'guest'
export type Access = 'view' | 'comment' | 'edit' | 'full'
export type Workspace = { id: string; name: string }
export type Space = { id: string; name: string; color: string; icon: string | null; is_private: boolean; position: number }
export type List = { id: string; space_id: string; folder_id: string | null; name: string; position: number }
export type Folder = { id: string; space_id: string; name: string; position: number }
export type Person = { id: string; name: string; email: string | null; role: Role; avatar_url: string | null }

type State = {
  loading: boolean
  workspace: Workspace | null
  role: Role | null
  spaces: Space[]
  lists: List[]
  folders: Folder[]
  myAccess: Record<string, Access>
  people: Person[]
  refresh: () => Promise<void>
  level: (spaceId: string) => number
}

const Ctx = createContext<State | null>(null)
const LEVEL: Record<Access, number> = { view: 1, comment: 2, edit: 3, full: 4 }

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session!.user.id
  const [s, set] = useState<Omit<State, 'refresh' | 'level'>>({
    loading: true, workspace: null, role: null, spaces: [], lists: [], folders: [], myAccess: {}, people: [],
  })

  const refresh = useCallback(async () => {
    const { data: profile } = await supabase.from('profiles').select('theme').eq('id', userId).single()
    if (profile?.theme) applyTheme(profile.theme as Theme)

    const { data: ws } = await supabase.from('workspaces').select('id, name').order('created_at').limit(1)
    const workspace = ws?.[0] ?? null
    if (!workspace) { set({ loading: false, workspace: null, role: null, spaces: [], lists: [], folders: [], myAccess: {}, people: [] }); return }

    const [{ data: members }, { data: spaces }, { data: lists }, { data: access }, { data: folders }] = await Promise.all([
      supabase.from('workspace_members').select('user_id, role').eq('workspace_id', workspace.id),
      supabase.from('spaces').select('id, name, color, icon, is_private, position').eq('workspace_id', workspace.id).order('position').order('created_at'),
      supabase.from('lists').select('id, space_id, folder_id, name, position').eq('workspace_id', workspace.id).eq('archived', false).order('position').order('created_at'),
      supabase.from('space_members').select('space_id, access').eq('user_id', userId),
      supabase.from('folders').select('id, space_id, name, position').eq('workspace_id', workspace.id).order('position').order('created_at'),
    ])
    const ids = (members ?? []).map(m => m.user_id)
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', ids)
    const people: Person[] = (members ?? []).map(m => {
      const p = profiles?.find(x => x.id === m.user_id)
      return { id: m.user_id, name: p?.full_name || p?.email || 'Unknown', email: p?.email ?? null, role: m.role as Role, avatar_url: p?.avatar_url ?? null }
    }).sort((a, b) => a.name.localeCompare(b.name))
    const me = members?.find(m => m.user_id === userId)
    set({
      people,
      loading: false, workspace, role: (me?.role ?? null) as Role | null,
      spaces: spaces ?? [], lists: lists ?? [], folders: folders ?? [],
      myAccess: Object.fromEntries((access ?? []).map(a => [a.space_id, a.access as Access])),
    })
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  const level = (spaceId: string) => {
    if (s.role === 'owner' || s.role === 'admin') return 4
    const a = s.myAccess[spaceId]
    if (a) return LEVEL[a]
    const sp = s.spaces.find(x => x.id === spaceId)
    return s.role === 'member' && sp && !sp.is_private ? 3 : 0
  }

  return <Ctx.Provider value={{ ...s, refresh, level }}>{children}</Ctx.Provider>
}

/** Like useWorkspace, but returns null outside the provider (for shared components). */
export function useWorkspaceMaybe() { return useContext(Ctx) }

export function useWorkspace() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace outside provider')
  return v
}

export const isAdmin = (r: Role | null) => r === 'owner' || r === 'admin'
