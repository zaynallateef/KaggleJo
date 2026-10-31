import type { Category, DirectoryResponse, Overview, Profile, Rankings } from './types'
import { rankingCsv, staticResponse, type PublicSnapshot } from './staticData'

export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
export const IS_STATIC = import.meta.env.VITE_DATA_MODE === 'static'
export const PROFILE_ACTION = IS_STATIC ? 'Get listed' : 'Add a profile'
let snapshotPromise: Promise<PublicSnapshot> | undefined
let loadedAt = 0
export async function loadStaticSnapshot(): Promise<PublicSnapshot> {
  if (!snapshotPromise || Date.now() - loadedAt > 60000) {
    loadedAt = Date.now()
    snapshotPromise = fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error('The public dataset is unavailable. Please try again shortly.')
      const body = await response.json() as PublicSnapshot
      if (body.schema_version !== 1 || body.meta?.mode !== 'live' || !Array.isArray(body.members) || !body.rankings || !body.profiles || !body.overviews) throw new Error('The published dataset is invalid.')
      return body
    }).catch(error => { snapshotPromise = undefined; throw error })
  }
  return snapshotPromise
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (IS_STATIC) {
    if (init?.method && init.method !== 'GET') throw new Error('Profile inclusion is automatic on the public site. Set your public Kaggle location to Jordan.')
    const data = await loadStaticSnapshot()
    if (init?.signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    return staticResponse(data, path) as T
  }
  const response = await fetch(`${API}/api${path}`, init)
  const body = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }))
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.')
  return body as T
}
export const getOverview = (category: Category, signal?: AbortSignal) => request<Overview>(`/overview?category=${category}`, { signal })
export const getRankings = (params: URLSearchParams, signal?: AbortSignal) => request<Rankings>(`/leaderboard?${params}`, { signal })
export const getProfile = (username: string, signal?: AbortSignal) => request<Profile>(`/members/${encodeURIComponent(username)}`, { signal })
export const getDirectory = (params: URLSearchParams, signal?: AbortSignal) => request<DirectoryResponse>(`/members?${params}`, { signal })
export async function downloadRankings(params: URLSearchParams) {
  const text = rankingCsv(await loadStaticSnapshot(), params)
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `kagglejo-${params.get('category') || 'competitions'}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
