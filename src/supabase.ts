import { categories, type DirectoryPerson, type Overview } from './types'
import type { PublicSnapshot } from './staticData'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
export const HAS_SUPABASE = Boolean(SUPABASE_URL && publicKey)
const validCities = new Set(['Amman', 'Irbid', 'Zarqa', 'Aqaba', 'Salt', 'Madaba', 'Karak', 'Mafraq', 'Ajloun', 'Jerash', 'Tafilah', 'Maan', 'Other', 'Not specified'])
interface Membership {
  username: string; kaggle_id: number; display_name: string; city: string
  evidence_url: string; review_basis: 'public_profile' | 'owner_opt_in'; reviewed_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateSnapshot(value: unknown): asserts value is PublicSnapshot {
  if (!isRecord(value) || value.schema_version !== 1 || !isRecord(value.meta) || value.meta.mode !== 'live'
    || !Array.isArray(value.members) || !isRecord(value.profiles) || !isRecord(value.rankings) || !isRecord(value.overviews)
    || !isRecord(value.community)) throw new Error('The published dataset is invalid.')
  for (const { value: category } of categories) {
    if (!Array.isArray(value.rankings[category]) || !isRecord(value.overviews[category])) throw new Error('The published dataset is invalid.')
  }
  if (!value.members.every(row => isRecord(row) && Number.isSafeInteger(row.id) && typeof row.username === 'string'
    && typeof row.display_name === 'string' && typeof row.city === 'string' && typeof row.joined === 'string')) throw new Error('The published dataset is invalid.')
}

export async function supabaseRpc<T>(name: 'kagglejo_directory' | 'kagglejo_nominate', body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!HAS_SUPABASE) throw new Error('Community submissions are not configured yet.')
  // Only the public project key belongs here. Build configuration also checks it.
  if (publicKey.startsWith('sb_secret_')) throw new Error('Invalid public Supabase configuration.')
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', signal,
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = isRecord(result) ? result.code : ''
    const message = isRecord(result) && typeof result.message === 'string' ? result.message : ''
    if (code === '22023' || (code === 'P0001' && message.includes('submission limit'))) throw new Error(message)
    throw new Error('The community service is unavailable. Please try again shortly.')
  }
  return result as T
}

export function mergeMemberships(envelope: unknown): PublicSnapshot {
  if (!isRecord(envelope) || !Array.isArray(envelope.memberships)) throw new Error('The community dataset is invalid.')
  validateSnapshot(envelope.snapshot)
  const source = envelope.snapshot
  if (envelope.memberships.length > 1000) throw new Error('The community registry is too large.')
  const approvals = new Map<string, Membership>(), ids = new Set<number>()
  for (const raw of envelope.memberships) {
    if (!isRecord(raw) || typeof raw.username !== 'string' || !/^[a-z0-9_]{3,50}$/.test(raw.username)
      || !Number.isSafeInteger(raw.kaggle_id) || Number(raw.kaggle_id) <= 0 || typeof raw.display_name !== 'string'
      || !raw.display_name.trim() || typeof raw.city !== 'string' || !validCities.has(raw.city)
      || raw.evidence_url !== `https://www.kaggle.com/${raw.username}`
      || !['public_profile', 'owner_opt_in'].includes(String(raw.review_basis))
      || typeof raw.reviewed_at !== 'string' || !Number.isFinite(Date.parse(raw.reviewed_at))
      || approvals.has(raw.username) || ids.has(Number(raw.kaggle_id))) throw new Error('The community registry is invalid.')
    const approval = raw as unknown as Membership
    approvals.set(approval.username, approval); ids.add(approval.kaggle_id)
  }
  // Remove revoked community-only members immediately, even before the next
  // Kaggle import. Location-discovered members remain independently eligible.
  const members: DirectoryPerson[] = source.members.filter(person => person.membership_source !== 'community_review'
    || approvals.get(person.username.toLowerCase())?.kaggle_id === person.id).map(person => {
      const approval = approvals.get(person.username.toLowerCase())
      return person.membership_source === 'community_review' && approval
        ? { ...person, city: approval.city, membership_reviewed_at: approval.reviewed_at } : { ...person }
    })
  const profiles = Object.fromEntries(members.map(person => [person.username.toLowerCase(), source.profiles[person.username.toLowerCase()] || { achievements: [], history: [] }]))
  for (const approval of approvals.values()) {
    const match = members.find(person => person.username.toLowerCase() === approval.username || person.id === approval.kaggle_id)
    if (match) {
      if (match.id !== approval.kaggle_id || match.username.toLowerCase() !== approval.username) throw new Error('A community identity needs operator review.')
      continue
    }
    members.push({ id: approval.kaggle_id, username: approval.username, display_name: approval.display_name,
      city: approval.city, joined: '', location_source: approval.evidence_url, is_demo: 0,
      overall_tier: 'Unspecified', organization: '', location: '', progression_opt_out: 0,
      membership_source: 'community_review', membership_reviewed_at: approval.reviewed_at,
      has_ranking: 0, ranked_categories: [] })
    profiles[approval.username] = { achievements: [], history: [] }
  }
  const byId = new Map(members.map(person => [person.id, person]))
  const rankings = { ...source.rankings }, overviews = { ...source.overviews }
  const cityCounts: Record<string, number> = {}, tierCounts: Record<string, number> = {}
  for (const person of members) {
    person.has_ranking = 0; person.ranked_categories = []
    cityCounts[person.city] = (cityCounts[person.city] || 0) + 1
    const tier = person.overall_tier || 'Unspecified'
    tierCounts[tier] = (tierCounts[tier] || 0) + 1
    const profile = profiles[person.username.toLowerCase()]
    profiles[person.username.toLowerCase()] = { ...profile, achievements: profile.achievements.map(achievement => ({ ...achievement })) }
  }
  for (const { value: category } of categories) {
    const rows = source.rankings[category].filter(row => byId.has(row.id)).map(row => ({ ...row, ...byId.get(row.id)! }))
    let lastPoints: number | undefined, rank = 0
    rows.forEach((row, index) => {
      if (row.points !== lastPoints) rank = index + 1
      row.local_rank = rank; lastPoints = row.points
      const person = byId.get(row.id)!
      person.has_ranking = 1; person.ranked_categories.push(category)
      const achievement = profiles[person.username.toLowerCase()].achievements.find(item => item.category === category)
      if (achievement) achievement.local_rank = rank
    })
    rankings[category] = rows
    const tiers: Record<string, number> = {}
    rows.forEach(row => { if (row.tier) tiers[row.tier] = (tiers[row.tier] || 0) + 1 })
    overviews[category] = { ...source.overviews[category], total_members: members.length, ranked_members: rows.length,
      unranked_members: members.length - rows.length, cities: cityCounts, tiers, top: rows.slice(0, 3),
      medals: source.overviews[category].medals === null ? null : rows.reduce((sum, row) => sum + (row.gold || 0) + (row.silver || 0) + (row.bronze || 0), 0),
      gold_medals: source.overviews[category].gold_medals === null ? null : rows.reduce((sum, row) => sum + (row.gold || 0), 0),
    } satisfies Overview
  }
  const ranked = members.filter(person => person.has_ranking).length
  return { ...source, members, profiles, rankings, overviews,
    community: { total_members: members.length, ranked_members: ranked, unranked_members: members.length - ranked, cities: cityCounts, tiers: tierCounts } }
}

export async function loadSupabaseDirectory(): Promise<PublicSnapshot> {
  return mergeMemberships(await supabaseRpc('kagglejo_directory'))
}

export async function submitNomination(payload: { username: string; city: string; evidence_url: string; confirmed: boolean }): Promise<{ message: string }> {
  const result = await supabaseRpc<unknown>('kagglejo_nominate', { p_username: payload.username, p_city: payload.city,
    p_evidence_url: payload.evidence_url, p_confirmed: payload.confirmed })
  if (!isRecord(result) || typeof result.message !== 'string') throw new Error('The community service returned an invalid response.')
  return { message: result.message }
}
