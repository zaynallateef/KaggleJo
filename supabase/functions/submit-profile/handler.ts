const cities = new Set(['Amman', 'Irbid', 'Zarqa', 'Aqaba', 'Salt', 'Madaba', 'Karak', 'Mafraq', 'Ajloun', 'Jerash', 'Tafilah', 'Maan', 'Other', 'Not specified'])
const origins = new Set(['https://zaynallateef.github.io', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173'])
type Environment = { url: string; secretKey: string; publishableKeys: string[] }
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value)
class PublicError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
class ServiceError extends Error { constructor(readonly stage: string, readonly status = 0) { super(stage) } }

export function createHandler(env: Environment, transport: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') || ''
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
    if (origins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin
      headers['Access-Control-Allow-Headers'] = 'apikey, content-type'
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    }
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !origins.has(origin)) return reply({ message: 'Origin is not allowed.' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ message: 'Use POST.' }, 405)
    if (!env.publishableKeys.includes(request.headers.get('apikey') || '')) return reply({ message: 'Invalid project key.' }, 401)
    const rpc = async (name: string, body: RecordValue = {}): Promise<unknown> => {
      const auth: Record<string, string> = { apikey: env.secretKey, 'Content-Type': 'application/json' }
      if (!env.secretKey.startsWith('sb_secret_')) auth.Authorization = `Bearer ${env.secretKey}`
      const response = await transport(`${env.url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        if (record(data) && data.code === '22023' && typeof data.message === 'string') throw new PublicError(data.message)
        if (record(data) && data.code === 'P0001' && typeof data.message === 'string' && data.message.includes('submission limit'))
          throw new PublicError('The community submission limit was reached. Please try again tomorrow.', 429)
        throw new ServiceError(`rpc:${name}`, response.status)
      }
      return data
    }
    let saved = false
    try {
      if (!env.url || !env.secretKey) throw new ServiceError('server_configuration')
      const raw = await request.text()
      if (new TextEncoder().encode(raw).length > 2048) throw new PublicError('Send only the profile fields.', 413)
      let payload: unknown
      try { payload = JSON.parse(raw) } catch { throw new PublicError('Send valid profile fields.') }
      if (!record(payload)) throw new PublicError('Send valid profile fields.')
      const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : ''
      const link = typeof payload.evidence_url === 'string' ? payload.evidence_url.trim().toLowerCase().replace(/\/$/, '') : ''
      if (!/^[a-z0-9_]{3,50}$/.test(username) || typeof payload.city !== 'string' || !cities.has(payload.city)
          || ![`https://www.kaggle.com/${username}`, `https://kaggle.com/${username}`].includes(link) || payload.confirmed !== true)
        throw new PublicError('Use a matching Kaggle profile link, choose a city, and confirm the Jordan community connection.')
      await rpc('kagglejo_nominate', { p_username: username, p_city: payload.city, p_evidence_url: link, p_confirmed: true })
      saved = true
      const existing = await rpc('kagglejo_accept_submission', { p_username: username })
      if (record(existing) && existing.status === 'approved') return reply(existing)
      if (record(existing) && existing.status === 'blocked') throw new PublicError('This profile cannot be added automatically. Contact the site operator.', 409)
      const token = await rpc('kagglejo_automation_token')
      if (typeof token !== 'string' || !token) throw new ServiceError('kaggle_configuration')
      let pageToken = ''
      const seen = new Set<string>()
      let account: RecordValue | undefined
      for (let page = 0; page < 5; page++) {
        const response = await transport('https://api.kaggle.com/v1/search.SearchApiService/ListEntities', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'kaggle-api/v1.7.0' },
          body: JSON.stringify({ filters: { query: username, privacy: 'PUBLIC', documentTypes: ['USER'] },
            usersOrderBy: 'SEARCH_USERS_ORDER_BY_DISPLAY_NAME', pageSize: 100, pageToken }), signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new ServiceError('kaggle_http', response.status)
        const data: unknown = await response.json()
        if (!record(data) || (data.documents !== undefined && !Array.isArray(data.documents))) throw new ServiceError('kaggle_payload')
        account = (data.documents || []).find((doc: unknown): doc is RecordValue => record(doc) && doc.documentType === 'USER'
          && doc.isPrivate !== true && record(doc.ownerUser) && typeof doc.ownerUser.userName === 'string'
          && doc.ownerUser.userName.toLowerCase() === username)
        if (account) break
        if (typeof data.nextPageToken !== 'string' || !data.nextPageToken) break
        if (seen.has(data.nextPageToken)) throw new Error('Repeated Kaggle page')
        pageToken = data.nextPageToken; seen.add(pageToken)
      }
      if (!account || !Number.isSafeInteger(account.id) || Number(account.id) <= 0 || !record(account.ownerUser))
        return reply({ status: 'checking', message: 'The exact public Kaggle account is not available in search yet. We will retry automatically during the next update; no manual review is needed.' }, 202)
      const displayName = typeof account.ownerUser.displayName === 'string' ? account.ownerUser.displayName.trim() : username
      const accepted = await rpc('kagglejo_accept_submission', { p_username: username, p_kaggle_id: account.id, p_display_name: displayName || username })
      if (!record(accepted) || accepted.status !== 'approved') throw new PublicError('This profile cannot be added automatically. Contact the site operator.', 409)
      return reply(accepted)
    } catch (error) {
      if (error instanceof PublicError) return reply({ message: error.message }, error.status)
      console.warn('automatic_profile_check_failed', error instanceof ServiceError ? { stage: error.stage, status: error.status } : { stage: 'transport' })
      // Never return upstream bodies, headers, tokens, or exception strings.
      if (!saved) return reply({ message: 'Your submission could not be saved. Please try again shortly.' }, 503)
      return reply({ status: 'checking', message: 'Your submission will be checked automatically during the next update. No manual review is needed.' }, 202)
    }
  }
}
