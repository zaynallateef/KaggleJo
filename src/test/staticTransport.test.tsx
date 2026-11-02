import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let api: typeof import('../api')
const member = { id: 1, username: 'public_member', display_name: 'Public Member', city: 'Amman', joined: '2025-01-01', location_source: 'https://www.kaggle.com/public_member', is_demo: 0, overall_tier: 'Contributor', has_ranking: 0, ranked_categories: [] }
const snapshot = { schema_version: 1, generated_at: '2026-10-31T00:00:00Z', meta: { mode: 'live' }, community: { total_members: 1, ranked_members: 0, unranked_members: 1, cities: { Amman: 1 }, tiers: { Contributor: 1 } }, members: [member], profiles: { public_member: { achievements: [], history: [] } }, rankings: { competitions: [], datasets: [], notebooks: [], discussions: [] }, overviews: { competitions: { ranked_members: 0 } } }

beforeEach(async () => {
  vi.stubEnv('VITE_DATA_MODE', 'static')
  vi.stubEnv('BASE_URL', '/KaggleJo/')
  vi.resetModules()
  api = await import('../api')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })))
})
afterEach(() => { vi.unstubAllEnvs() })

describe('static hosting transport', () => {
  it('fetches only the public JSON under the repository path and shares that fetch across views', async () => {
    const [directory, profile] = await Promise.all([api.getDirectory(new URLSearchParams()), api.getProfile('public_member')])
    expect(api.IS_STATIC).toBe(true)
    expect(directory.total).toBe(1)
    expect(profile.member.username).toBe('public_member')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/KaggleJo/data/snapshot.json', { cache: 'no-cache' })
  })
  it('never sends mutation requests or nomination data to a server', async () => {
    await expect(api.request('/nominations', { method: 'POST', body: 'private form contents' })).rejects.toThrow('automatic')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('revalidates immediately on refresh while sharing the next request', async () => {
    await api.getDirectory(new URLSearchParams())
    api.invalidateSnapshot()
    const newer = { ...snapshot, community: { ...snapshot.community, total_members: 2 } }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(newer), { status: 200 }))
    const [directory] = await Promise.all([api.getDirectory(new URLSearchParams()), api.getProfile('public_member')])
    expect(directory.community.total_members).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('an old failed request cannot clear a newer refresh request', async () => {
    let failOld!: (reason: Error) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((_, reject) => { failOld = reject }))
    const old = api.getDirectory(new URLSearchParams()).catch(() => undefined)
    api.invalidateSnapshot()
    await api.getDirectory(new URLSearchParams())
    failOld(new Error('Old connection failed'))
    await old
    await api.getDirectory(new URLSearchParams())
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('rejects demo publications and permits recovery after a failed load', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...snapshot, meta: { mode: 'demo' } }), { status: 200 }))
    await expect(api.getDirectory(new URLSearchParams())).rejects.toThrow('invalid')
    expect((await api.getDirectory(new URLSearchParams())).total).toBe(1)
  })
  it('honors cancellation without breaking a simultaneous reader', async () => {
    const controller = new AbortController()
    controller.abort()
    const results = await Promise.allSettled([api.getProfile('public_member', controller.signal), api.getDirectory(new URLSearchParams())])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } })
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { total: 1 } })
  })
})
