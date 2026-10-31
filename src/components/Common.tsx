import { ArrowUpRight, Medal, X, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { initials, type Member } from '../types'

export function Avatar({ member, large = false }: { member: Pick<Member, 'display_name' | 'id'>; large?: boolean }) {
  return <span className={`avatar avatar-${member.id % 5} ${large ? 'avatar-lg' : ''}`} aria-hidden="true">{initials(member.display_name)}</span>
}

export function TierBadge({ tier }: { tier?: string | null }) {
  const label = tier || 'Ranked'
  return <span className={`tier tier-${label.toLowerCase()}`} title={!tier ? 'A global rank is available; this source does not supply a category tier.' : undefined}><span className="tier-mark" aria-hidden="true" />{label}</span>
}

export function Medals({ member }: { member: Pick<Member, 'gold' | 'silver' | 'bronze'> }) {
  if ([member.gold, member.silver, member.bronze].some(value => value === null)) return <span className="unavailable-stat" title="Medal counts are not supplied by this data source.">Not supplied</span>
  return <span className="medal-group">{(['gold', 'silver', 'bronze'] as const).map(type =>
    <span className={`medal-count ${type}`} key={type} title={`${member[type]} ${type} medals`}><Medal size={15} weight="duotone" aria-hidden="true" /><span className="sr-only">{type}: </span>{member[type]}</span>)}</span>
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  return <dialog className={`modal ${wide ? 'modal-wide' : ''}`} ref={ref} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose() }} aria-labelledby="dialog-title">
    <div className="modal-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={21} /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><WarningCircle size={24} /><div><strong>We couldn’t load that.</strong><p>{message}</p>{retry && <button className="text-button" onClick={retry}>Try again <ArrowUpRight size={15} /></button>}</div></div>
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="skeleton-list" role="status" aria-label="Loading rankings">{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}><span /><span /><span /></div>)}</div>
}
