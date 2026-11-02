import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeMemberships } from '../supabase'
import type { PublicSnapshot } from '../staticData'

const member = { id: 1, username: 'automatic_member', display_name: 'Automatic Member', city: 'Amman', joined: '2025-01-01', location_source: 'https://www.kaggle.com/automatic_member', is_demo: 0, overall_tier: 'Contributor', has_ranking: 0, ranked_categories: [] }
const approval = { username: 'loplop05', kaggle_id: 2, display_name: 'Public Member', city: 'Not specified', evidence_url: 'https://www.kaggle.com/loplop05', review_basis: 'public_profile', reviewed_at: '2026-01-01T00:00:00Z' }
const overview = { ranked_members: 0, total_members: 1, unranked_members: 1, medals: null, gold_medals: null, cities: { Amman: 1 }, tiers: {}, top: [], meta: { mode: 'live' } }
const snapshot = { schema_version: 1, generated_at: '2026-01-01T00:00:00Z', meta: { mode: 'live', updated_at: '2026-01-01T00:00:00Z' },
  members: [member], profiles: { automatic_member: { achievements: [], history: [] } },
  community: { total_members: 1, ranked_members: 0, unranked_members: 1, cities: { Amman: 1 }, tiers: { Contributor: 1 } },
  rankings: { competitions: [], datasets: [], notebooks: [], discussions: [] },
  overviews: { competitions: overview, datasets: overview, notebooks: overview, discussions: overview } } as unknown as PublicSnapshot

describe('approved community memberships', () => {
  it('makes an approved account searchable immediately without fabricating statistics or a location', () => {
    const merged = mergeMemberships({ snapshot, memberships: [approval] })
    expect(merged.members.find(p => p.username === 'loplop05')).toMatchObject({ id: 2, city: 'Not specified', location: '', has_ranking: 0, membership_source: 'community_review', overall_tier: 'Unspecified' })
    expect(merged.profiles.loplop05.achievements).toEqual([])
    expect(merged.community).toMatchObject({ total_members: 2, unranked_members: 2 })
    expect(merged.overviews.competitions.total_members).toBe(2)
    expect(snapshot.members).toHaveLength(1)
  })
  it('removes revoked approvals immediately while retaining automatically discovered members', () => {
    const approved = mergeMemberships({ snapshot, memberships: [approval] })
    const removed = mergeMemberships({ snapshot: approved, memberships: [] })
    expect(removed.members.map(p => p.username)).toEqual(['automatic_member'])
    expect(removed.profiles).not.toHaveProperty('loplop05')
    expect(removed.community.total_members).toBe(1)
  })
  it('does not duplicate people who also appear in country discovery', () => {
    const known = { ...approval, username: member.username, kaggle_id: member.id, evidence_url: member.location_source }
    expect(mergeMemberships({ snapshot, memberships: [known] }).members).toHaveLength(1)
    expect(() => mergeMemberships({ snapshot, memberships: [{ ...known, kaggle_id: 999 }] })).toThrow('identity')
  })
  it('rejects invalid registries and missing or demonstration publications', () => {
    expect(() => mergeMemberships({ snapshot: null, memberships: [] })).toThrow('invalid')
    expect(() => mergeMemberships({ snapshot: { ...snapshot, meta: { mode: 'demo' } }, memberships: [] })).toThrow('invalid')
    expect(() => mergeMemberships({ snapshot, memberships: [approval, approval] })).toThrow('invalid')
    expect(() => mergeMemberships({ snapshot, memberships: [{ ...approval, evidence_url: 'https://example.com' }] })).toThrow('invalid')
  })
  it('removes revoked ranking rows and recalculates ranks, facets, and medals', () => {
    const reviewed = mergeMemberships({ snapshot, memberships: [approval] })
    const row = (id: number, username: string, points: number) => ({ ...member, id, username, category: 'competitions', tier: null, points, global_rank: id, local_rank: id, gold: null, silver: null, bronze: null })
    const ranked = { ...reviewed, rankings: { ...reviewed.rankings, competitions: [row(2, 'loplop05', 200), row(1, member.username, 100)] } }
    const revoked = mergeMemberships({ snapshot: ranked, memberships: [] })
    expect(revoked.rankings.competitions).toMatchObject([{ username: member.username, local_rank: 1 }])
    expect(revoked.community.ranked_members).toBe(1)
    expect(revoked.overviews.competitions.ranked_members).toBe(1)
    expect(revoked.overviews.competitions.medals).toBeNull()
  })
})

describe('Supabase website transport', () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'static'); vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test') })
  afterEach(() => vi.unstubAllEnvs())
  it('reads live memberships on refresh and submits through the restricted RPC', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.body === '{}' ? { snapshot, memberships: [approval] } : { message: 'Profile submitted for review.' }))))
    const api = await import('../api')
    expect((await api.getDirectory(new URLSearchParams({ q: '@loplop05' }))).total).toBe(1)
    expect(fetch).toHaveBeenCalledWith('https://example.supabase.co/rest/v1/rpc/kagglejo_directory', expect.objectContaining({ cache: 'no-store', headers: { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' } }))
    expect(api.PROFILE_ACTION).toBe('Add a profile')
    await api.request('/nominations', { method: 'POST', body: JSON.stringify({ username: 'new_person', city: 'Amman', evidence_url: 'https://www.kaggle.com/new_person', confirmed: true }) })
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('kagglejo_nominate')
    api.invalidateSnapshot()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ snapshot, memberships: [] })))
    expect((await api.getDirectory(new URLSearchParams({ q: 'loplop05' }))).total).toBe(0)
  })
  it('does not silently fall back to a stale JSON file when Supabase fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    const api = await import('../api')
    await expect(api.getDirectory(new URLSearchParams())).rejects.toThrow('unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
