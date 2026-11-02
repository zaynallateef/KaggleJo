import { ArrowRight, ArrowsClockwise, ArrowsLeftRight, Info, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { getOverview, getRankings, invalidateSnapshot, IS_STATIC } from './api'
import { categories, type Member, type Overview, type Rankings } from './types'
import { About } from './components/About'
import { AddProfileDialog } from './components/AddProfileDialog'
import { Community } from './components/Community'
import { CompareDialog } from './components/CompareDialog'
import { Header, type View } from './components/Header'
import { Leaderboard, type Filters } from './components/Leaderboard'
import { ProfileDialog } from './components/ProfileDialog'
import { ErrorState } from './components/Common'

function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search)
  const cat = categories.find(c => c.value === params.get('category'))?.value || 'competitions'
  const rawPage = Number(params.get('page'))
  return { category: cat, q: (params.get('q') || '').slice(0, 80), city: (params.get('city') || '').slice(0, 100), tier: ['Grandmaster', 'Master', 'Expert'].includes(params.get('tier') || '') ? params.get('tier')! : '', page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1 }
}
function readView(): View { return window.location.hash === '#leaderboard' ? 'leaderboard' : window.location.hash === '#about' ? 'about' : 'community' }

export default function App() {
  const [view, setView] = useState<View>(readView)
  const [filters, setFilters] = useState<Filters>(readFilters)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [rankings, setRankings] = useState<Rankings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [profile, setProfile] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Member[]>([])
  const [comparing, setComparing] = useState(false)
  function reloadSnapshot() { invalidateSnapshot(); setRefresh(value => value + 1) }

  useEffect(() => {
    const listener = () => { setView(readView()); setFilters(readFilters()) }
    window.addEventListener('popstate', listener); window.addEventListener('hashchange', listener)
    return () => { window.removeEventListener('popstate', listener); window.removeEventListener('hashchange', listener) }
  }, [])
  useEffect(() => {
    const refreshVisiblePage = () => { if (document.visibilityState === 'visible') reloadSnapshot() }
    const interval = window.setInterval(refreshVisiblePage, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', refreshVisiblePage)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshVisiblePage) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ category: filters.category, page: String(filters.page) })
      if (filters.q) params.set('q', filters.q)
      if (filters.city) params.set('city', filters.city)
      if (filters.tier) params.set('tier', filters.tier)
      Promise.all([getOverview(filters.category, controller.signal), getRankings(params, controller.signal)]).then(([stats, rows]) => {
        setOverview(stats); setRankings(rows); setLoading(false)
        if (stats.meta.category_tiers_available === 'false' && filters.tier) setFilters(current => ({ ...current, tier: '', page: 1 }))
        else if (filters.page > rows.pages) setFilters(current => ({ ...current, page: rows.pages }))
      }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false) } })
    }, filters.q ? 220 : 0)
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [filters, refresh])

  function navigate(next: View) { setView(next); window.scrollTo({ top: 0, behavior: 'instant' }) }
  function update(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    const params = new URLSearchParams({ category: next.category })
    if (next.q) params.set('q', next.q)
    if (next.city) params.set('city', next.city)
    if (next.tier) params.set('tier', next.tier)
    if (next.page > 1) params.set('page', String(next.page))
    window.history.replaceState(null, '', `?${params}#${view}`)
  }
  function toggle(member: Member) { setSelected(current => current.some(m => m.id === member.id) ? current.filter(m => m.id !== member.id) : current.length < 3 ? [...current, member] : current) }
  const demo = overview?.meta.mode === 'demo'
  const date = overview?.meta.updated_at ? new Date(overview.meta.updated_at) : null
  const stale = date && Date.now() - date.getTime() > (IS_STATIC ? 6 * 3600000 : 7 * 86400000)

  return <><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a><Header view={view} navigate={navigate} onAdd={() => setAdding(true)} /><main className="page-container" id="main" tabIndex={-1}>
    <div className="status-bar"><div><span className={`status-dot ${demo ? 'demo-dot' : ''}`} /><span>{demo ? 'Demo workspace' : overview ? 'Community index' : 'Connecting to the community'}</span><span className="status-divider">/</span><span className="status-source">{demo ? 'Fictional profiles & sample rankings' : overview?.meta.source || 'Kaggle public profiles'}</span></div><button className="refresh-button" disabled={loading} onClick={reloadSnapshot} title="Reload the latest stored snapshot"><ArrowsClockwise size={14} className={loading ? 'refreshing' : ''} /><span>{date ? `Snapshot ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Amman' })}` : 'Load snapshot'}</span></button></div>
    {stale && !demo && <div className="notice"><Info size={16} /> This snapshot is more than {IS_STATIC ? 'six hours' : 'seven days'} old. Updates may be delayed; profiles and rankings may have changed on Kaggle.</div>}
    {view !== 'leaderboard' && error && <ErrorState message={error} retry={reloadSnapshot} />}
    {view === 'leaderboard' ? <Leaderboard filters={filters} update={update} overview={overview} rankings={rankings} loading={loading} error={error} retry={reloadSnapshot} onProfile={setProfile} onAdd={() => setAdding(true)} onAbout={() => { window.location.hash = 'about'; navigate('about') }} selected={selected} toggle={toggle} /> : view === 'community' ? <Community refresh={refresh} onProfile={setProfile} onAdd={() => setAdding(true)} /> : <About />}
    <footer className="site-footer"><div><a href="#leaderboard" className="footer-brand" onClick={() => navigate('leaderboard')}>Kaggle<span>Jo.</span></a><span>Built for Jordan’s data curious.</span></div><p>Independent community project. Not affiliated with Kaggle.</p><a href="#about" onClick={() => navigate('about')}>Behind the rankings <ArrowRight size={14} /></a></footer>
  </main>{selected.length > 0 && <div className="compare-tray" role="region" aria-label="Selected Kagglers"><ArrowsLeftRight size={20} /><div><strong>{selected.length} selected</strong><span>{selected.map(m => m.display_name.split(' ')[0]).join(', ')}</span></div><button className="button button-small" disabled={selected.length < 2} onClick={() => setComparing(true)}>Compare <ArrowRight size={15} /></button><button className="icon-button" onClick={() => setSelected([])} aria-label="Clear comparison"><X size={18} /></button></div>}
    {profile && <ProfileDialog username={profile} close={() => setProfile(null)} />}{adding && <AddProfileDialog close={() => setAdding(false)} />}{comparing && <CompareDialog members={selected} close={() => setComparing(false)} />}
  </>
}
