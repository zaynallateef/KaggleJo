import type { Achievement, Category, DirectoryPerson, DirectoryResponse, Member, Meta, Overview, Profile } from './types'
import { matchesPerson, searchTerms } from './search'

export interface PublicSnapshot {
  schema_version: number; generated_at: string; meta: Meta
  community: DirectoryResponse['community']; members: DirectoryPerson[]
  profiles: Record<string, { achievements: Achievement[]; history: Profile['history'] }>
  rankings: Record<Category, Member[]>; overviews: Record<Category, Overview>
}

function pageNumber(params: URLSearchParams, key: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(params.get(key) || fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Choose valid pagination values.')
  return value
}
function paginate<T>(items: T[], params: URLSearchParams, fallback: number) {
  const page = pageNumber(params, 'page', 1), pageSize = pageNumber(params, 'page_size', fallback, 100)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, page_size: pageSize, pages: Math.max(1, Math.ceil(items.length / pageSize)) }
}
function category(params: URLSearchParams): Category {
  const value = params.get('category') || 'competitions'
  if (!['competitions', 'datasets', 'notebooks', 'discussions'].includes(value)) throw new Error('Choose a valid ranking category.')
  return value as Category
}
function rankingRows(snapshot: PublicSnapshot, params: URLSearchParams) {
  const terms = searchTerms(params.get('q') || ''), city = params.get('city'), tier = params.get('tier')
  return snapshot.rankings[category(params)].filter(row => matchesPerson(row, terms) && (!city || row.city === city) && (!tier || row.tier === tier))
}

export function staticResponse(snapshot: PublicSnapshot, path: string): unknown {
  const url = new URL(path, 'https://kagglejo.invalid')
  const params = url.searchParams
  if (url.pathname === '/overview') return snapshot.overviews[category(params)]
  if (url.pathname === '/leaderboard') return { ...paginate(rankingRows(snapshot, params), params, 10), category: category(params), meta: snapshot.meta }
  if (url.pathname === '/members') {
    const terms = searchTerms(params.get('q') || ''), city = params.get('city'), tier = params.get('tier'), status = params.get('status'), sort = params.get('sort') || 'name'
    if (!['', 'ranked', 'unranked'].includes(status || '') || !['name', 'newest', 'tier'].includes(sort)) throw new Error('Choose valid directory filters.')
    const tierOrder: Record<string, number> = { Grandmaster: 4, Master: 3, Expert: 2, Contributor: 1, Novice: 0, Unspecified: -1 }
    const items = snapshot.members.filter(row => matchesPerson(row, terms) && (!city || row.city === city) && (!tier || row.overall_tier === tier) && (!status || Boolean(row.has_ranking) === (status === 'ranked'))).sort((a, b) => {
      if (sort === 'newest' && a.joined !== b.joined) return b.joined.localeCompare(a.joined)
      if (sort === 'tier') { const difference = (tierOrder[b.overall_tier || 'Unspecified'] ?? -1) - (tierOrder[a.overall_tier || 'Unspecified'] ?? -1); if (difference) return difference }
      return a.display_name.localeCompare(b.display_name, 'en') || a.username.localeCompare(b.username, 'en')
    })
    return { ...paginate(items, params, 24), community: snapshot.community, meta: snapshot.meta }
  }
  if (url.pathname.startsWith('/members/')) {
    const username = decodeURIComponent(url.pathname.slice('/members/'.length)).toLowerCase()
    const member = snapshot.members.find(person => person.username.toLowerCase() === username)
    if (!member || !Object.hasOwn(snapshot.profiles, username)) throw new Error('This profile was not found.')
    return { member, ...snapshot.profiles[username], meta: snapshot.meta }
  }
  throw new Error('This action is unavailable on the public static site.')
}

export function rankingCsv(snapshot: PublicSnapshot, params: URLSearchParams) {
  const fields = ['local_rank', 'display_name', 'username', 'city', 'tier', 'global_rank', 'points', 'gold', 'silver', 'bronze', 'is_demo'] as const
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value)
    if (/^[=+\-@]/.test(text.trimStart()) || /^[\t\r\n]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return [fields.join(','), ...rankingRows(snapshot, params).map(row => fields.map(field => cell(row[field])).join(','))].join('\r\n')
}
