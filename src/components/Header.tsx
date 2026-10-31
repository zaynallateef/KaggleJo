import { ArrowUpRight, ChartBar, List, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { PROFILE_ACTION } from '../api'

export type View = 'leaderboard' | 'community' | 'about'
export function Header({ view, navigate, onAdd }: { view: View; navigate: (view: View) => void; onAdd: () => void }) {
  const [menu, setMenu] = useState(false)
  return <header className="site-header"><div className="header-inner">
    <a href="#community" className="brand" onClick={() => navigate('community')} aria-label="KaggleJo home"><span className="brand-symbol"><ChartBar weight="fill" size={23} /></span>Kaggle<span className="brand-jo">Jo<span className="brand-dot">.</span></span></a>
    <nav className={menu ? 'main-nav nav-open' : 'main-nav'} aria-label="Main navigation">{(['community', 'leaderboard', 'about'] as View[]).map(item => <a href={`#${item}`} key={item} aria-current={view === item ? 'page' : undefined} onClick={() => { navigate(item); setMenu(false) }}>{item[0].toUpperCase() + item.slice(1)}</a>)}</nav>
    <div className="header-actions"><a className="kaggle-link" href="https://www.kaggle.com/rankings" target="_blank" rel="noreferrer">Explore Kaggle <ArrowUpRight size={15} /></a><button className="button button-small" onClick={onAdd}>{PROFILE_ACTION} <span aria-hidden="true">+</span></button><button className="icon-button mobile-menu" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={menu ? 'Close menu' : 'Open menu'}>{menu ? <X size={21} /> : <List size={21} />}</button></div>
  </div></header>
}
