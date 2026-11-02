import { ArrowUpRight, GlobeHemisphereWest, MapPin, Trophy } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { getProfile, IS_STATIC } from '../api'
import { categories, format, type Profile } from '../types'
import { Avatar, ErrorState, Medals, Modal, Skeleton, TierBadge } from './Common'

export function ProfileDialog({ username, close }: { username: string; close: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    getProfile(username, controller.signal).then(setProfile).catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => controller.abort()
  }, [username, attempt])
  return <Modal title="Kaggler profile" onClose={close} wide>{error ? <ErrorState message={error} retry={() => setAttempt(attempt + 1)} /> : !profile ? <Skeleton rows={4} /> : <>
    <div className="profile-heading"><Avatar member={profile.member} large /><div><h3>{profile.member.display_name}</h3><p>@{profile.member.username}</p><span className="profile-location"><MapPin size={14} />{profile.member.membership_source === 'community_review' ? 'Jordan community connection' : profile.member.location || `${profile.member.city}, Jordan`}</span></div></div>
    {profile.member.membership_source === 'community_review' && <div className="notice">Community-submitted Jordan connection. {profile.member.city !== 'Not specified' && `Community city: ${profile.member.city}. `}{profile.member.location && `Kaggle profile location: ${profile.member.location}. `}This is not a verified location or account-ownership check. {!profile.member.checked_at && 'Kaggle statistics will be checked during the next scheduled update.'}</div>}
    {profile.member.is_demo ? <div className="notice">This is a fictional demonstration profile. Its statistics are sample data.</div> : <a className="subtle-link" href={`https://www.kaggle.com/${encodeURIComponent(profile.member.username)}`} target="_blank" rel="noreferrer">View on Kaggle <ArrowUpRight size={15} /></a>}
    {profile.member.organization && <p className="profile-organization">{profile.member.organization}</p>}
    {!!profile.member.progression_opt_out && <div className="notice">This member has chosen not to share progression. Their public profile is included in the community without ranking statistics.</div>}
    {!profile.member.progression_opt_out && <div className="profile-achievements">{categories.map(cat => {
      const achievement = profile.achievements.find(a => a.category === cat.value)
      const available = !profile.meta.available_categories || profile.meta.available_categories.split(',').includes(cat.value)
      return <section key={cat.value}><h4>{cat.label}</h4>{achievement ? <>{achievement.tier ? <TierBadge tier={achievement.tier} /> : <p className="profile-category-status">{achievement.global_rank ? 'Category tier not supplied' : 'Not ranked in this category'}</p>}<div className="profile-numbers"><span><Trophy size={16} /> <strong>{achievement.local_rank ? `#${achievement.local_rank}` : '—'}</strong> Jordan</span><span><GlobeHemisphereWest size={16} /> <strong>{achievement.global_rank ? `#${format(achievement.global_rank)}` : '—'}</strong> global</span></div><div className="profile-score"><strong>{format(achievement.points)}</strong> points <Medals member={achievement} /></div></> : <p className="muted">{available ? 'No ranked achievement in this snapshot.' : 'Not supplied by the current data source.'}</p>}</section>
    })}</div>}
    <div className="snapshot-note"><h4>Ranking snapshots</h4><p>{new Set(profile.history.map(h => h.recorded_at)).size} recorded snapshot(s). {IS_STATIC ? 'History is limited to the currently published snapshot.' : 'History grows after each data import.'} No estimated movement is shown.</p></div>
  </>}</Modal>
}
