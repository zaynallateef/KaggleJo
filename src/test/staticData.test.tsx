import { describe, expect, it } from 'vitest'
import { rankingCsv, staticResponse, type PublicSnapshot } from '../staticData'
import type { DirectoryPerson, DirectoryResponse, Rankings } from '../types'

const person: DirectoryPerson = { id: 1, username: 'new_member', display_name: 'New Member', city: 'Irbid', joined: '2025-01-01', location_source: 'https://www.kaggle.com/new_member', is_demo: 0, overall_tier: 'Contributor', organization: 'Jordan University', has_ranking: 0, ranked_categories: [] }
const ranked: DirectoryPerson = { ...person, id: 2, username: 'ranked_member', display_name: '=Formula Name', city: 'Amman', overall_tier: 'Expert', has_ranking: 1, ranked_categories: ['competitions'] }
const ranking = { ...ranked, category: 'competitions' as const, tier: null, points: 1000, global_rank: 42, local_rank: 1, gold: null, silver: null, bronze: null }
const snapshot = {
  schema_version: 1, generated_at: '2026-10-31T00:00:00Z', meta: { mode: 'live' },
  community: { total_members: 2, ranked_members: 1, unranked_members: 1, cities: { Amman: 1, Irbid: 1 }, tiers: { Expert: 1, Contributor: 1 } },
  members: [person, ranked], profiles: { new_member: { achievements: [], history: [] }, ranked_member: { achievements: [ranking], history: [] } },
  rankings: { competitions: [ranking], datasets: [], notebooks: [], discussions: [] },
  overviews: { competitions: { ranked_members: 1, total_members: 2, top: [ranking], meta: { mode: 'live' } } },
} as unknown as PublicSnapshot

describe('published snapshot queries', () => {
  it('includes unranked people and filters by highest tier, city, status, and organization', () => {
    const data = staticResponse(snapshot, '/members?tier=Contributor&city=Irbid&status=unranked&q=University') as DirectoryResponse
    expect(data.total).toBe(1)
    expect(data.items[0].username).toBe('new_member')
    expect(data.community.total_members).toBe(2)
  })
  it('preserves category ranks when filtering and paginating', () => {
    const data = staticResponse(snapshot, '/leaderboard?category=competitions&city=Amman&page_size=1') as Rankings
    expect(data.items[0].local_rank).toBe(1)
    expect(data.items[0].tier).toBeNull()
    expect(data.items[0].gold).toBeNull()
  })
  it('supports literal searches and rejects invalid pagination and category inputs', () => {
    expect((staticResponse(snapshot, '/members?q=%25') as DirectoryResponse).total).toBe(0)
    expect(() => staticResponse(snapshot, '/members?page=-1')).toThrow()
    expect(() => staticResponse(snapshot, '/leaderboard?category=admin')).toThrow()
    expect(() => staticResponse(snapshot, '/members?sort=secret')).toThrow()
  })
  it('accepts profile URLs, handles, and reordered search words', () => {
    for (const q of ['@NEW_MEMBER', 'https://www.kaggle.com/new_member/', 'University New']) {
      expect((staticResponse(snapshot, `/members?${new URLSearchParams({ q })}`) as DirectoryResponse).total).toBe(1)
    }
    expect((staticResponse(snapshot, '/leaderboard?q=%40RANKED_MEMBER') as Rankings).total).toBe(1)
  })
  it('looks up profiles case-insensitively and refuses unknown or prototype names', () => {
    expect(staticResponse(snapshot, '/members/NEW_MEMBER')).toMatchObject({ member: { username: 'new_member' }, achievements: [] })
    expect(() => staticResponse(snapshot, '/members/__proto__')).toThrow('not found')
  })
  it('exports filtered CSV without spreadsheet formula injection or invented missing values', () => {
    const text = rankingCsv(snapshot, new URLSearchParams({ category: 'competitions', city: 'Amman' }))
    expect(text).toContain("'=Formula Name")
    expect(text).not.toContain('null')
    expect(text).not.toContain('new_member')
  })
  it('has no mutation endpoints', () => {
    expect(() => staticResponse(snapshot, '/nominations')).toThrow('unavailable')
  })
  it('blocks spreadsheet formulas hidden behind leading whitespace', () => {
    const copy = { ...snapshot, rankings: { ...snapshot.rankings, competitions: [{ ...ranking, display_name: '  =CMD()' }] } }
    expect(rankingCsv(copy, new URLSearchParams({ category: 'competitions' }))).toContain("'  =CMD()")
  })
})
