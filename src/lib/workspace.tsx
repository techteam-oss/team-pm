import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { applyTheme, type Theme } from './theme'

export type Role = 'owner' | 'admin' | 'member' | 'guest'
export type Access = 'view' | 'comment' | 'edit' | 'full'
export type Workspace = { id: string; name: string }
export type Space = { id: string; name: string; color: string; is_private: boolean; position: number }
export type List = { id: string; space_id: string; name: string; position: number }

type State = {
  loading: boolean
  workspace: Workspace | null
  role: Role | null
  spaces: Space[]
  lists: List[]
  myAccess: Record<string, Access>
  refresh: () => Promise<void>
  level: (spaceId: string) => number
}

const Ctx = createContext<State | null>(null)
const LEVEL: Record<Access, number> = { view: 1, comment: 2, edit: 3, full: 4 }

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session!.user.id
  const [s, set] = useState<Omit<State, 'refresh' | 'level'>>({
    loading: true, workspace: null, role: null, spaces: [], lists: [], myAccess: {},
  })

  const refresh = useCallback(async () => {
    const { data: profile } = await supabase.from('profiles').select('theme').eq('id', userId).single()
    if (profile?.theme) applyTheme(profile.theme as Theme)

    const { data: ws } = await supabase.from('workspaces').select('id, name').order('created_at').limit(1)
    const workspace = ws?.[0] ?? null
    if (!workspace) { set({ loading: false, workspace: null, role: null, spaces: [], lists: [], myAccess: {} }); return }

    const [{ data: me }, { data: spaces }, { data: lists }, { data: access }] = await Promise.all([
      supabase.from('workspace_members').select('role').eq('workspace_id', workspace.id).eq('user_id', userId).single(),
      supabase.from('spaces').select('id, name, color, is_private, position').eq('workspace_id', workspace.id).order('position').order('created_at'),
      supabase.from('lists').select('id, space_id, name, position').eq('workspace_id', workspace.id).eq('archived', false).order('position').order('created_at'),
      supabase.from('space_members').select('space_id, access').eq('user_id', userId),
    ])
    set({
      loading: false, workspace, role: (me?.role ?? null) as Role | null,
      spaces: spaces ?? [], lists: lists ?? [],
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

export function useWorkspace() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace outside provider')
  return v
}

export const isAdmin = (r: Role | null) => r === 'owner' || r === 'admin'
