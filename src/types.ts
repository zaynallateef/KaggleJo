export type Category = 'competitions' | 'datasets' | 'notebooks' | 'discussions'
export type Tier = 'Grandmaster' | 'Master' | 'Expert' | 'Contributor' | 'Novice' | 'Unspecified'
export interface Meta { mode?: 'demo' | 'live'; updated_at?: string; source?: string; available_categories?: string; medals_available?: string; category_tiers_available?: string; discovery?: string }
export interface Person {
  id: number; username: string; display_name: string; city: string; joined: string
  location_source: string; is_demo: number; overall_tier?: Tier; organization?: string
  location?: string; progression_opt_out?: number; checked_at?: string
}
export interface Achievement {
  category: Category; tier: Tier | null; points: number
  global_rank: number | null; gold: number | null; silver: number | null; bronze: number | null; local_rank: number | null
}
export interface Member extends Person, Achievement {
  global_rank: number; local_rank: number
}
export interface DirectoryPerson extends Person {
  has_ranking: number; ranked_categories: Category[]
}
export interface DirectoryResponse {
  items: DirectoryPerson[]; total: number; page: number; page_size: number; pages: number; meta: Meta
  community: { total_members: number; ranked_members: number; unranked_members: number; cities: Record<string, number>; tiers: Record<string, number> }
}
export interface Rankings {
  items: Member[]; total: number; page: number; page_size: number; pages: number; category: Category; meta: Meta
}
export interface Overview {
  ranked_members: number; total_members: number; unranked_members?: number; medals: number | null; gold_medals: number | null
  cities: Record<string, number>; tiers: Record<string, number>; top: Member[]; meta: Meta
}
export interface Profile {
  member: Person; achievements: Achievement[]; meta: Meta
  history: { category: Category; recorded_at: string; points: number; local_rank: number; global_rank: number }[]
}
export const categories: { value: Category; label: string; description: string }[] = [
  { value: 'competitions', label: 'Competitions', description: 'Solving real problems. Raising the bar.' },
  { value: 'datasets', label: 'Datasets', description: 'Open data. Shared possibilities.' },
  { value: 'notebooks', label: 'Notebooks', description: 'Ideas worth running. Knowledge worth sharing.' },
  { value: 'discussions', label: 'Discussions', description: 'Moving the conversation forward.' },
]
export const cities = ['Amman', 'Irbid', 'Zarqa', 'Aqaba', 'Salt', 'Madaba', 'Other']
export const format = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
export const initials = (name: string) => name.split(' ').slice(0, 2).map(x => x[0]).join('')
