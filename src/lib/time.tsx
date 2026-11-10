import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export type Running = { id: string; task_id: string; started_at: string; task: { title: string; list_id: string } | null }
type Ctx = { running: Running | null; start: (taskId: string) => Promise<void>; stop: () => Promise<void>; refresh: () => Promise<void> }
const TimerCtx = createContext<Ctx>({ running: null, start: async () => {}, stop: async () => {}, refresh: async () => {} })

export function TimerProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const [running, setRunning] = useState<Running | null>(null)

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('time_entries').select('id, task_id, started_at, task:tasks(title, list_id)')
      .eq('user_id', uid).is('ended_at', null).maybeSingle()
    setRunning(data as unknown as Running | null)
  }, [uid])

  useEffect(() => {
    refresh()
    const ch = supabase.channel(`timer-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `user_id=eq.${uid}` }, () => refresh())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid, refresh])

  async function stop() {
    if (!running) return
    const ended = new Date(Math.min(Date.now(), new Date(running.started_at).getTime() + 24 * 3600 * 1000)).toISOString()
    const { error } = await supabase.from('time_entries').update({ ended_at: ended }).eq('id', running.id)
    if (error) alert(error.message)
    await refresh()
  }
  async function start(taskId: string) {
    if (running) await stop()
    const { error } = await supabase.from('time_entries').insert({ task_id: taskId })
    if (error) alert(error.message)
    await refresh()
  }
  return <TimerCtx.Provider value={{ running, start, stop, refresh }}>{children}</TimerCtx.Provider>
}

export const useTimer = () => useContext(TimerCtx)

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function fmtMinutes(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** Parses "1h 30m", "1.5h", "90m", "90", "1:30" into minutes. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  let m = s.match(/^(\d+):(\d{1,2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s))
  let total = 0, matched = false
  for (const part of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)/g)) {
    matched = true
    total += part[2].startsWith('h') ? Number(part[1]) * 60 : Number(part[1])
  }
  return matched ? Math.round(total) : null
}
