import { ArrowDown, ArrowRight, ArrowUpRight, CaretLeft, CaretRight, Code, Database, GlobeHemisphereWest, Info, MagnifyingGlass, MapPin, Medal, SlidersHorizontal, Trophy, Users, X, ChatCircle } from '@phosphor-icons/react'
import { PROFILE_ACTION } from '../api'
import { ExportRankings } from './ExportRankings'
import { categories, cities, format, type Category, type Member, type Overview, type Rankings } from '../types'
import { Avatar, ErrorState, Medals, Skeleton, TierBadge } from './Common'

export interface Filters { category: Category; q: string; city: string; tier: string; page: number }
interface Props {
  filters: Filters; update: (patch: Partial<Filters>) => void; overview: Overview | null
  rankings: Rankings | null; loading: boolean; error: string; retry: () => void
  onProfile: (username: string) => void; onAdd: () => void; onAbout: () => void
  selected: Member[]; toggle: (member: Member) => void
}
const icons = { competitions: Trophy, datasets: Database, notebooks: Code, discussions: ChatCircle }

export function Leaderboard({ filters, update, overview, rankings, loading, error, retry, onProfile, onAdd, onAbout, selected, toggle }: Props) {
  const category = categories.find(c => c.value === filters.category)!
  const params = new URLSearchParams({ category: filters.category, q: filters.q, city: filters.city, tier: filters.tier })
  const activeFilters = !!(filters.q || filters.city || filters.tier)
  const available = overview?.meta.available_categories?.split(',') || categories.map(c => c.value)
  const categoryAvailable = available.includes(filters.category)
  const categoryTiersKnown = overview?.meta.category_tiers_available !== 'false'
  const cityOptions = overview ? [...new Set([...cities, ...Object.keys(overview.cities)])].sort() : cities
  return <>
    <section className="hero">
      <div><div className="hero-eyebrow"><span className="jordan-flag" aria-hidden="true" /><span>A COMMUNITY WORTH COUNTING</span></div><h1>Jordan, on the <br /><span>leaderboard.</span></h1><p>Discover the people pushing data science forward.<br className="desktop-break" /> Local talent. Global ambition.</p></div>
      <div className="hero-aside"><div className="orbit-mark" aria-hidden="true"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-ring ring-three" /><span>jo<span>.</span></span><div className="orbit-dot dot-one" /><div className="orbit-dot dot-two" /><div className="orbit-dot dot-three" /></div><span className="hero-aside-caption">A small country. A world of potential.</span></div>
    </section>

    <section className="stats-grid" aria-label={`${category.label} community statistics`}>
      <Stat label="Kagglers in Jordan" value={overview?.total_members} icon={<Users size={19} />} note="Everyone in the community index" />
      <Stat label="Ranked in this category" value={categoryAvailable ? overview?.ranked_members : null} icon={<Trophy size={19} />} note={`Across ${category.label.toLowerCase()}`} />
      <Stat label="Cities represented" value={overview ? Object.keys(overview.cities).filter(c => !['Not specified', 'Other'].includes(c)).length : undefined} icon={<MapPin size={19} />} note="Based on public profile locations" />
      <Stat label={overview?.meta.medals_available === 'false' ? 'Without a category rank' : 'Medals earned'} value={overview?.meta.medals_available === 'false' ? categoryAvailable ? overview.unranked_members : null : overview?.medals} icon={<Medal size={19} />} note={overview?.meta.medals_available === 'false' ? 'Discover them in the community' : `Across ${category.label.toLowerCase()}`} gold />
    </section>

    <section className="rankings-section" aria-labelledby="rankings-title">
      <div className="section-heading"><div><h2 id="rankings-title">The Jordan leaderboard <span className="country-tag">JO</span></h2><p>Your local view of a global community.</p></div><button className="subtle-link" onClick={onAbout}><Info size={16} /> How rankings work</button></div>
      <div className="category-tabs" role="tablist" aria-label="Ranking category" onKeyDown={event => {
        const index = categories.findIndex(c => c.value === filters.category)
        const next = event.key === 'ArrowRight' ? (index + 1) % categories.length : event.key === 'ArrowLeft' ? (index + categories.length - 1) % categories.length : event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : -1
        if (next >= 0) { event.preventDefault(); update({ category: categories[next].value, page: 1 }); document.getElementById(`tab-${categories[next].value}`)?.focus() }
      }}>{categories.map(({ value, label }) => {
        const Icon = icons[value]
        return <button role="tab" tabIndex={filters.category === value ? 0 : -1} aria-selected={filters.category === value} aria-controls="ranking-panel" id={`tab-${value}`} key={value} className={filters.category === value ? 'active' : ''} onClick={() => update({ category: value, page: 1 })}><Icon size={18} />{label}</button>
      })}</div>
      <div role="tabpanel" id="ranking-panel" aria-labelledby={`tab-${filters.category}`}>
        {!categoryAvailable && <div className="notice"><Info size={16} />Discussion statistics aren’t supplied by the current Kaggle search source. Community profiles are still available.</div>}
        {overview?.meta.category_tiers_available === 'false' && categoryAvailable && <p className="ranking-source-note">Points and global ranks come from Kaggle public search. Category tiers and medal counts are not supplied by this source.</p>}
        <div className="podium-heading"><span><Trophy size={15} className="gold" /> LEADING THE WAY</span><span>{category.description}</span></div>
        <div className="podium-grid">{overview?.top.map((member, i) => <button className={`podium-card ${i === 0 ? 'podium-first' : ''}`} key={member.id} onClick={() => onProfile(member.username)}>
          <div className="podium-top"><span className="podium-rank">0{i + 1}<span> / JORDAN</span></span>{i === 0 ? <Trophy size={18} weight="duotone" className="gold" /> : <ArrowUpRight size={18} className="muted" />}</div>
          <div className="podium-person"><Avatar member={member} large /><div><h3>{member.display_name}</h3><TierBadge tier={member.tier} /></div></div>
          <div className="podium-bottom"><span><strong>{format(member.points)}</strong> pts</span><span><GlobeHemisphereWest size={14} /> #{format(member.global_rank)} global</span></div>
        </button>)}{!overview && Array.from({ length: 3 }, (_, i) => <div className="podium-card" key={i}><Skeleton rows={1} /></div>)}</div>

        <div className="leaderboard-layout">
          <div className="table-panel">
            <div className="filter-bar"><label className="search-field"><MagnifyingGlass size={18} /><input aria-label="Search Kagglers" placeholder="Search name or username…" value={filters.q} onChange={e => update({ q: e.target.value, page: 1 })} maxLength={80} />{filters.q && <button onClick={() => update({ q: '', page: 1 })} aria-label="Clear search"><X size={14} /></button>}</label><div className="select-filters"><label><span className="sr-only">Filter by city</span><select value={filters.city} onChange={e => update({ city: e.target.value, page: 1 })}><option value="">All cities</option>{cityOptions.map(city => <option key={city}>{city}</option>)}</select></label><label><span className="sr-only">Filter by tier</span><select disabled={!categoryTiersKnown} title={!categoryTiersKnown ? 'Category tiers are not supplied by this data source. Filter by highest tier in the Community directory.' : undefined} value={filters.tier} onChange={e => update({ tier: e.target.value, page: 1 })}><option value="">{categoryTiersKnown ? 'All tiers' : 'Tier unavailable'}</option>{['Grandmaster', 'Master', 'Expert'].map(tier => <option key={tier}>{tier}</option>)}</select></label></div><ExportRankings params={params} /></div>
            <div className="table-caption"><span><SlidersHorizontal size={13} /> {activeFilters ? `${rankings?.total ?? '…'} matching Kagglers` : 'All ranked Kagglers'}</span><span>Select up to 3 to compare</span></div>
            {error ? <ErrorState message={error} retry={retry} /> : loading ? <Skeleton rows={8} /> : rankings?.items.length ? <div className="table-scroll"><table className="ranking-table"><caption className="sr-only">Jordan {category.label.toLowerCase()} rankings. Points descending.</caption><thead><tr><th className="checkbox-cell"><span className="sr-only">Compare</span></th><th scope="col">RANK</th><th scope="col">KAGGLER</th><th scope="col" className="global-cell">GLOBAL</th><th scope="col" className="medals-cell">MEDALS</th><th scope="col" className="points-cell">POINTS <ArrowDown size={11} /></th></tr></thead><tbody>{rankings.items.map(member => <tr key={member.id} className={selected.some(m => m.id === member.id) ? 'selected-row' : ''}>
              <td className="checkbox-cell"><input type="checkbox" aria-label={`Compare ${member.display_name}`} checked={selected.some(m => m.id === member.id)} disabled={selected.length >= 3 && !selected.some(m => m.id === member.id)} onChange={() => toggle(member)} /></td><td className="rank-cell" aria-label={`Jordan rank ${member.local_rank}`}>{member.local_rank <= 3 ? <span className={`rank-medal rank-${member.local_rank}`}>{member.local_rank}</span> : <span className="plain-rank">{String(member.local_rank).padStart(2, '0')}</span>}</td><td><button className="member-button" aria-label={`View ${member.display_name}'s profile`} onClick={() => onProfile(member.username)}><Avatar member={member} /><span className="member-info"><span className="member-name">{member.display_name}</span><span className="member-meta"><TierBadge tier={member.tier} /><span className="city-label">{member.city}</span></span></span></button></td><td className="global-cell tabular">#{format(member.global_rank)}</td><td className="medals-cell"><Medals member={member} /></td><td className="points-cell tabular">{format(member.points)}</td>
            </tr>)}</tbody></table></div> : <div className="empty-state"><MagnifyingGlass size={30} /><h3>{activeFilters ? 'No Kagglers found' : 'The leaderboard starts with you.'}</h3><p>{activeFilters ? 'Try another name or a wider set of filters.' : 'Add a profile to help build Jordan’s Kaggle community.'}</p><button className="text-button" onClick={() => activeFilters ? update({ q: '', city: '', tier: '', page: 1 }) : onAdd()}>{activeFilters ? 'Clear filters' : 'Add a profile'} <ArrowRight size={15} /></button></div>}
            <div className="pagination"><span>{rankings?.total ? `${(filters.page - 1) * rankings.page_size + 1}–${Math.min(filters.page * rankings.page_size, rankings.total)} of ${rankings.total} Kagglers` : '0 Kagglers'}</span><div><button className="icon-button" disabled={loading || filters.page === 1} onClick={() => update({ page: filters.page - 1 })} aria-label="Previous page"><CaretLeft size={16} /></button><span>{filters.page} <span className="muted">/ {rankings?.pages || 1}</span></span><button className="icon-button" disabled={loading || filters.page >= (rankings?.pages || 1)} onClick={() => update({ page: filters.page + 1 })} aria-label="Next page"><CaretRight size={16} /></button></div></div>
          </div>
          <aside className="leaderboard-sidebar"><div className="community-card"><div className="community-card-icon"><Users size={24} weight="duotone" /></div><span className="small-label">THERE’S ROOM FOR YOU</span><h3>The next name<br />could be yours.</h3><p>Building, learning, competing.<br />You’re part of the story.</p><button className="button" onClick={onAdd}>{PROFILE_ACTION} <ArrowUpRight size={16} /></button></div><div className="city-card"><h3>Across Jordan <MapPin size={15} /></h3>{overview && Object.entries(overview.cities).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([city, count]) => <button key={city} onClick={() => update({ city: filters.city === city ? '' : city, page: 1 })} className={filters.city === city ? 'city-active' : ''}><span>{city}</span><span>{count}<ArrowUpRight size={13} /></span></button>)}</div><p className="sidebar-note"><Info size={15} /><span>A community index based on shared public locations. Coverage grows as profiles become discoverable.</span></p></aside>
        </div>
      </div>
    </section>
  </>
}

function Stat({ label, value, icon, note, gold }: { label: string; value?: number | null; icon: React.ReactNode; note: string; gold?: boolean }) {
  return <div className={`stat ${gold ? 'stat-gold' : ''}`}><div className="stat-label">{label}{icon}</div><div className="stat-value">{value === undefined ? <span className="stat-placeholder" /> : value === null ? '—' : format(value)}</div><p>{note}</p></div>
}
