import { Check, Clock3, Undo2 } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import type { QaState } from '../lib/listData'
import Avatar from './Avatar'

export const QA_LABEL: Record<Exclude<QaState, null>, string> = {
  pending: 'Waiting for QA', approved: 'QA approved', changes: 'Sent back by QA',
}

/** The QA reviewer's avatar with a small mark for where the review stands. */
export default function QaBadge({ reviewer, state, size = 24 }: { reviewer: string | null; state: QaState; size?: number }) {
  const { people } = useWorkspace()
  if (!reviewer) return null
  const name = people.find(p => p.id === reviewer)?.name ?? 'Former member'
  const label = `QA: ${name}${state ? ` · ${QA_LABEL[state]}` : ''}`
  const Icon = state === 'approved' ? Check : state === 'changes' ? Undo2 : state === 'pending' ? Clock3 : null
  return (
    <span className={`qa-badge ${state ?? 'none'}`} title={label} aria-label={label} role="img">
      <Avatar id={reviewer} name={name} size={size} title={label} />
      <span className="qa-mark" aria-hidden>{Icon ? <Icon size={9} strokeWidth={3} /> : 'QA'}</span>
    </span>
  )
}
