import { describe, expect, it, vi } from 'vitest'
import { createHandler } from '../../supabase/functions/submit-profile/handler'

const env = { url: 'https://example.supabase.co', secretKey: 'sb_secret_test', publishableKeys: ['sb_publishable_test'] }
const payload = { username: 'new_person', city: 'Amman', evidence_url: 'https://www.kaggle.com/new_person', confirmed: true }
const account = { id: 1234, documentType: 'USER', isPrivate: false, ownerUser: { userName: 'new_person', displayName: 'New Person' }, userDocument: { userLocation: '' } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const request = (body: unknown = payload, key = 'sb_publishable_test', origin = 'https://zaynallateef.github.io') => new Request('https://example.supabase.co/functions/v1/submit-profile', {
  method: 'POST', headers: { apikey: key, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
function fixture(options: { documents?: unknown[]; kaggleFailure?: boolean; databaseFailure?: boolean; state?: string } = {}) {
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('api.kaggle.com')) return options.kaggleFailure ? json({ message: 'PRIVATE_ERROR_TOKEN' }, 503) : json({ documents: options.documents ?? [account] })
    if (url.endsWith('kagglejo_nominate')) return options.databaseFailure ? json({}, 503) : json({ message: 'saved' })
    if (url.endsWith('kagglejo_automation_token')) return json('TEST_TOKEN_FOR_KAGGLE_LOOKUP')
    if (url.endsWith('kagglejo_accept_submission')) {
      const body = JSON.parse(String(init?.body))
      return json({ status: options.state || (body.p_kaggle_id ? 'approved' : 'checking'), message: 'Profile added to the community.' })
    }
    throw new Error('Unexpected request')
  })
  return { transport, handle: createHandler(env, transport) }
}
describe('automatic public profile submissions', () => {
  it('accepts the exact public identity without requiring a shared location or trusting a client ID', async () => {
    const { handle, transport } = fixture()
    const response = await handle(request({ ...payload, kaggle_id: 999, review_basis: 'owner_opt_in' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'approved' })
    const call = transport.mock.calls.find(([url, init]) => String(url).endsWith('kagglejo_accept_submission') && String(init?.body).includes('1234'))!
    expect(JSON.parse(String(call[1]?.body))).toEqual({ p_username: 'new_person', p_kaggle_id: 1234, p_display_name: 'New Person' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://zaynallateef.github.io')
  })
  it('rejects invalid project keys, origins, and mismatched links before saving anything', async () => {
    const { handle, transport } = fixture()
    expect((await handle(request(payload, 'wrong'))).status).toBe(401)
    expect((await handle(request(payload, 'sb_publishable_test', 'https://evil.example'))).status).toBe(403)
    expect((await handle(request({ ...payload, evidence_url: 'https://www.kaggle.com/someone_else' }))).status).toBe(400)
    expect(transport).not.toHaveBeenCalled()
  })
  it('queues private, fuzzy, and unindexed accounts for automatic retries without publishing them', async () => {
    for (const documents of [[], [{ ...account, isPrivate: true }], [{ ...account, ownerUser: { userName: 'new_person2' } }]]) {
      const { handle, transport } = fixture({ documents })
      const response = await handle(request())
      expect(response.status).toBe(202)
      expect(await response.json()).toMatchObject({ status: 'checking' })
      expect(transport.mock.calls.some(([url, init]) => String(url).endsWith('kagglejo_accept_submission') && String(init?.body).includes('p_kaggle_id'))).toBe(false)
    }
  })
  it('keeps an already accepted member unchanged and avoids another Kaggle lookup', async () => {
    const { handle, transport } = fixture({ state: 'approved' })
    expect((await handle(request())).status).toBe(200)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('does not restore revoked or rejected members', async () => {
    const { handle, transport } = fixture({ state: 'blocked' })
    expect((await handle(request())).status).toBe(409)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('preserves a saved submission during Kaggle outages without exposing upstream secrets', async () => {
    const { handle } = fixture({ kaggleFailure: true })
    const response = await handle(request())
    expect(response.status).toBe(202)
    expect(await response.text()).not.toContain('PRIVATE_ERROR_TOKEN')
  })
  it('reports save failures instead of claiming a submission was queued', async () => {
    const { handle } = fixture({ databaseFailure: true })
    const response = await handle(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('could not be saved') })
  })
})
