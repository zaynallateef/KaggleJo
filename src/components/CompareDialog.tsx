import { useEffect, useState } from 'react'
import { getProfile } from '../api'
import { categories, format, type Member, type Profile } from '../types'
import { Avatar, ErrorState, Modal, Skeleton, TierBadge } from './Common'

export function CompareDialog({ members, close }: { members: Member[]; close: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    Promise.all(members.map(m => getProfile(m.username, controller.signal))).then(setProfiles).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [members, attempt])
  return <Modal title="Side by side" onClose={close} wide><p className="muted compare-intro">Different journeys. Shared ambition. Points are compared within each category.</p>{error ? <ErrorState message={error} retry={() => setAttempt(attempt + 1)} /> : !profiles.length ? <Skeleton rows={5} /> : <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${profiles.length}, minmax(0, 1fr))` }}>{profiles.map(profile => <div className="compare-column" key={profile.member.id}><Avatar member={profile.member} large /><h3>{profile.member.display_name}</h3><p className="muted">{profile.member.city}</p>{categories.map(category => {
    const item = profile.achievements.find(a => a.category === category.value)
    return <div className="compare-stat" key={category.value}><h4>{category.label}</h4>{item ? <>{item.tier && <TierBadge tier={item.tier} />}<strong>{format(item.points)} <span>pts</span></strong><p>{item.local_rank ? `#${item.local_rank} Jordan` : 'No Jordan rank'} · {item.global_rank ? `#${format(item.global_rank)} global` : 'No global rank'}</p></> : <p>Not supplied</p>}</div>
  })}</div>)}</div>}</Modal>
}
