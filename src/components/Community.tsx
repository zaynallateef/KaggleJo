import { ArrowRight, ArrowUpRight, CaretLeft, CaretRight, GlobeHemisphereWest, MagnifyingGlass, MapPin, Trophy, Users, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { getDirectory, PROFILE_ACTION } from '../api'
import { format, type DirectoryPerson, type DirectoryResponse } from '../types'
import { Avatar, ErrorState, Skeleton, TierBadge } from './Common'

interface DirectoryFilters { q: string; city: string; tier: string; status: string; sort: string; page: number }
const defaults: DirectoryFilters = { q: '', city: '', tier: '', status: '', sort: 'name', page: 1 }
function initialFilters(): DirectoryFilters {
  const params = new URLSearchParams(window.location.search)
  const page = Number(params.get('people_page'))
  return { q: (params.get('people_q') || '').slice(0, 80), city: params.get('people_city') || '', tier: params.get('people_tier') || '', status: params.get('people_status') || '', sort: params.get('people_sort') || 'name', page: Number.isSafeInteger(page) && page > 0 ? page : 1 }
}

export function Community({ refresh, onProfile, onAdd }: { refresh: number; onProfile: (username: string) => void; onAdd: () => void }) {
  const [filters, setFilters] = useState<DirectoryFilters>(initialFilters)
  const [data, setData] = useState<DirectoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  function update(patch: Partial<DirectoryFilters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    const params = new URLSearchParams(window.location.search)
    Object.entries(next).forEach(([key, value]) => {
      if (value && value !== defaults[key as keyof DirectoryFilters]) params.set(`people_${key}`, String(value))
      else params.delete(`people_${key}`)
    })
    window.history.replaceState(null, '', `${params.size ? '?' + params : ''}#community`)
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]))
      getDirectory(params, controller.signal).then(result => {
        setData(result); setLoading(false)
        if (filters.page > result.pages) setFilters(current => ({ ...current, page: result.pages }))
      }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false) } })
    }, filters.q ? 220 : 0)
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [filters, refresh, retry])
  const community = data?.community
  const cityOptions = community ? Object.keys(community.cities).sort((a, b) => a.localeCompare(b)) : []
  const cityCount = cityOptions.filter(city => !['Not specified', 'Other'].includes(city)).length
  const filtered = !!(filters.q || filters.city || filters.tier || filters.status)
  return <section className="directory-page">
    <div className="directory-hero"><div><div className="hero-eyebrow"><span className="jordan-flag" aria-hidden="true" /> THE PEOPLE BEHIND THE POSSIBILITIES</div><h1>Jordan’s Kaggle <br /><span>community.</span></h1><p>First notebook or global leaderboard.<br />There’s a place for everyone here.</p></div><div className="directory-hero-note"><Users size={32} weight="duotone" /><strong>Curiosity is the<br />only prerequisite.</strong><span>Discover the people learning,<br />building, and sharing in Jordan.</span></div></div>
    <div className="stats-grid directory-stats" aria-label="Jordan community statistics">
      <DirectoryStat label="Community members" value={community?.total_members} note="Public profiles in this index" icon={<Users size={18} />} />
      <DirectoryStat label="Ranked members" value={community?.ranked_members} note="In at least one available category" icon={<Trophy size={18} />} />
      <DirectoryStat label="Without a ranking" value={community?.unranked_members} note="Every journey belongs here" icon={<GlobeHemisphereWest size={18} />} />
      <DirectoryStat label="Cities represented" value={community ? cityCount : undefined} note="Based on shared profile locations" icon={<MapPin size={18} />} />
    </div>
    <div className="directory-heading"><div><h2>Meet the community <span className="country-tag">JO</span></h2><p>Browse everyone, including contributors and members without a ranking.</p></div><button className="button button-small" onClick={onAdd}>{PROFILE_ACTION} <ArrowUpRight size={15} /></button></div>
    <div className="directory-toolbar">
      <label className="search-field"><MagnifyingGlass size={18} /><input aria-label="Search community members" placeholder="Search name, username, or organization…" value={filters.q} maxLength={80} onChange={e => update({ q: e.target.value, page: 1 })} />{filters.q && <button onClick={() => update({ q: '', page: 1 })} aria-label="Clear community search"><X size={15} /></button>}</label>
      <div className="directory-filter-selects">
        <label><span className="sr-only">Community city</span><select value={filters.city} onChange={e => update({ city: e.target.value, page: 1 })}><option value="">All cities</option>{cityOptions.map(city => <option key={city}>{city}</option>)}</select></label>
        <label><span className="sr-only">Highest Kaggle tier</span><select value={filters.tier} onChange={e => update({ tier: e.target.value, page: 1 })}><option value="">All tiers</option>{['Novice', 'Contributor', 'Expert', 'Master', 'Grandmaster', 'Unspecified'].map(tier => <option key={tier} value={tier}>{tier === 'Unspecified' ? 'Tier not shared' : tier}</option>)}</select></label>
        <label><span className="sr-only">Ranking status</span><select value={filters.status} onChange={e => update({ status: e.target.value, page: 1 })}><option value="">Everyone</option><option value="ranked">Ranked members</option><option value="unranked">Without a ranking</option></select></label>
      </div>
    </div>
    {community && <div className="directory-city-shortcuts"><span>Explore</span>{Object.entries(community.cities).filter(([city]) => city !== 'Not specified').sort((a, b) => b[1] - a[1]).slice(0, 5).map(([city, count]) => <button key={city} className={filters.city === city ? 'active' : ''} onClick={() => update({ city: filters.city === city ? '' : city, page: 1 })}>{city} <span>{format(count)}</span></button>)}</div>}
    <div className="directory-results-header"><span role="status">{loading ? 'Loading community…' : `${format(data?.total || 0)} ${filtered ? 'matching' : ''} members`}</span><label><span>Sort by</span><select aria-label="Sort community members" value={filters.sort} onChange={e => update({ sort: e.target.value, page: 1 })}><option value="name">Name A–Z</option><option value="newest">Recently joined</option><option value="tier">Highest tier</option></select></label></div>
    {error ? <ErrorState message={error} retry={() => setRetry(retry + 1)} /> : loading ? <div className="directory-loading"><Skeleton rows={4} /><Skeleton rows={4} /><Skeleton rows={4} /></div> : data?.items.length ? <div className="people-grid">{data.items.map(person => <PersonCard key={person.id} person={person} onProfile={onProfile} />)}</div> : <div className="empty-state"><Users size={32} /><h3>{filtered ? 'No members match those filters.' : 'Be part of the first chapter.'}</h3><p>{filtered ? 'Try another name, city, or tier.' : 'Submit a public Kaggle profile to help grow the community.'}</p><button className="text-button" onClick={() => filtered ? update({ ...defaults }) : onAdd()}>{filtered ? 'Clear community filters' : 'Add a profile'} <ArrowRight size={15} /></button></div>}
    <div className="pagination directory-pagination"><span>{data?.total ? `${(filters.page - 1) * data.page_size + 1}–${Math.min(filters.page * data.page_size, data.total)} of ${format(data.total)} members` : '0 members'}</span><div><button className="icon-button" aria-label="Previous community page" disabled={loading || filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}><CaretLeft size={16} /></button><span>{filters.page} <span className="muted">/ {data?.pages || 1}</span></span><button className="icon-button" aria-label="Next community page" disabled={loading || filters.page >= (data?.pages || 1)} onClick={() => update({ page: filters.page + 1 })}><CaretRight size={16} /></button></div></div>
    {filters.q && !loading && !error && <p className="directory-coverage">Missing someone? Search accepts names, @usernames, and Kaggle profile links. <a className="subtle-link" href={`https://www.kaggle.com/search?q=${encodeURIComponent(filters.q)}`} target="_blank" rel="noreferrer">Check Kaggle <ArrowUpRight size={13} /></a> or <button className="text-button" onClick={onAdd}>{PROFILE_ACTION.toLowerCase()}</button>. This search covers our latest snapshot; a missing result does not mean the account is absent from Kaggle.</p>}
    <p className="directory-coverage">Includes public Kaggle locations and, when community submissions are enabled, reviewed Jordan connections. Community-approved profiles are labeled separately. Membership is not a nationality, residency, or identity check.</p>
  </section>
}

function DirectoryStat({ label, value, note, icon }: { label: string; value?: number; note: string; icon: React.ReactNode }) {
  return <div className="stat"><div className="stat-label">{label}{icon}</div><div className="stat-value">{value === undefined ? '—' : format(value)}</div><p>{note}</p></div>
}

function PersonCard({ person, onProfile }: { person: DirectoryPerson; onProfile: (username: string) => void }) {
  const joined = new Date(person.joined)
  const location = person.membership_source === 'community_review'
    ? `Jordan connection${person.city === 'Not specified' ? '' : ` · ${person.city}`}`
    : person.city === 'Not specified' ? 'Jordan · City not shared' : `${person.city}, Jordan`
  return <button className="directory-person-card" onClick={() => onProfile(person.username)} aria-label={`View ${person.display_name}'s profile`}>
    <div className="directory-person-top"><Avatar member={person} large /><ArrowUpRight size={17} /></div>
    <h3>{person.display_name}</h3><p className="directory-username">@{person.username}</p>
    <div className="directory-tier"><TierBadge tier={person.overall_tier || 'Unspecified'} /><span>{person.progression_opt_out ? 'Progression hidden' : 'Highest Kaggle tier'}</span></div>
    <p className="directory-location"><MapPin size={14} />{location}</p>
    {person.membership_source === 'community_review' && <p className="directory-organization">Community approved</p>}
    <p className="directory-organization">{person.organization || (Number.isNaN(joined.getTime()) ? 'Kaggle community member' : `On Kaggle since ${joined.getFullYear()}`)}</p>
    <div className={`directory-person-bottom ${person.has_ranking ? 'person-ranked' : ''}`}><span>{person.progression_opt_out ? 'Progression not shared' : person.has_ranking ? `Ranked in ${person.ranked_categories.length} ${person.ranked_categories.length === 1 ? 'category' : 'categories'}` : 'Not ranked yet'}</span><span>View profile <ArrowRight size={13} /></span></div>
  </button>
}
