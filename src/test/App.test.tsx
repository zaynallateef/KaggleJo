import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { categories, type Member } from '../types'

const meta = { mode: 'demo', updated_at: '2026-10-31T00:00:00Z', source: 'Fictional sample data' }
const members: Member[] = [
  { id: 1, username: 'demo_omar', display_name: 'Omar Haddad', city: 'Amman', joined: '2020-01-01', location_source: 'demo', is_demo: 1, category: 'competitions', tier: 'Grandmaster', points: 24000, global_rank: 100, gold: 5, silver: 3, bronze: 2, local_rank: 1 },
  { id: 2, username: 'demo_sara', display_name: 'Sara Al-Khatib', city: 'Irbid', joined: '2020-01-01', location_source: 'demo', is_demo: 1, category: 'competitions', tier: 'Master', points: 12000, global_rank: 200, gold: 2, silver: 1, bronze: 0, local_rank: 2 },
  { id: 3, username: 'demo_ahmad', display_name: 'Ahmad Nasser', city: 'Amman', joined: '2021-01-01', location_source: 'demo', is_demo: 1, category: 'competitions', tier: 'Expert', points: 6000, global_rank: 300, gold: 0, silver: 1, bronze: 1, local_rank: 3 },
]
let failing = false
let submissionError = false
let requests: string[] = []

beforeEach(() => {
  window.history.replaceState(null, '', '/#leaderboard')
  failing = false; submissionError = false; requests = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    requests.push(url.pathname + url.search)
    if (failing) return new Response(JSON.stringify({ error: 'The API is unavailable.' }), { status: 503 })
    let body: unknown
    if (url.pathname.endsWith('/overview')) body = { ranked_members: 3, total_members: 3, medals: 15, gold_medals: 7, cities: { Amman: 2, Irbid: 1 }, tiers: { Grandmaster: 1, Master: 1, Expert: 1 }, top: members, meta }
    else if (url.pathname.endsWith('/leaderboard')) {
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const city = url.searchParams.get('city')
      const filtered = members.filter(m => (!q || m.display_name.toLowerCase().includes(q)) && (!city || m.city === city))
      body = { items: filtered, total: filtered.length, page: 1, page_size: 10, pages: 1, category: url.searchParams.get('category'), meta }
    } else if (url.pathname === '/api/members') {
      const extra = { ...members[0], id: 4, username: 'new_contributor', display_name: 'New Contributor', city: 'Karak', overall_tier: 'Contributor', has_ranking: 0, ranked_categories: [] }
      const people = [...members.map(m => ({ ...m, overall_tier: m.tier, has_ranking: 1, ranked_categories: ['competitions'] })), extra]
      const q = (url.searchParams.get('q') || '').toLowerCase(), city = url.searchParams.get('city'), tier = url.searchParams.get('tier'), status = url.searchParams.get('status')
      const filtered = people.filter(m => (!q || (m.display_name + m.username).toLowerCase().includes(q)) && (!city || m.city === city) && (!tier || m.overall_tier === tier) && (!status || Boolean(m.has_ranking) === (status === 'ranked')))
      body = { items: filtered, total: filtered.length, page: 1, page_size: 24, pages: 1, meta, community: { total_members: 4, ranked_members: 3, unranked_members: 1, cities: { Amman: 2, Irbid: 1, Karak: 1 }, tiers: { Grandmaster: 1, Master: 1, Expert: 1, Contributor: 1 } } }
    } else if (url.pathname.includes('/members/')) {
      const newcomer = { ...members[0], id: 4, username: 'new_contributor', display_name: 'New Contributor', city: 'Karak', overall_tier: 'Contributor' }
      const member = [...members, newcomer].find(m => m.username === url.pathname.split('/').pop())!
      const unranked = member.id === 4
      body = { member, achievements: categories.map(c => ({ ...member, category: c.value, ...(unranked ? { tier: null, local_rank: null, global_rank: null, points: 0, gold: null, silver: null, bronze: null } : {}) })), history: unranked ? [] : [{ category: 'competitions', recorded_at: meta.updated_at, points: member.points, local_rank: member.local_rank }], meta }
    } else if (url.pathname.endsWith('/nominations')) {
      expect(options?.method).toBe('POST')
      if (submissionError) return new Response(JSON.stringify({ error: 'This profile is already awaiting review.' }), { status: 409 })
      return new Response(JSON.stringify({ message: 'Profile submitted for review. Rankings appear after the next import.' }), { status: 201 })
    } else throw new Error('Unexpected test request: ' + url.pathname)
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})

async function ready() {
  render(<App />)
  await screen.findByRole('checkbox', { name: 'Compare Omar Haddad' })
}

describe('KaggleJo journeys (mock API)', () => {
  it('labels sample data and opens category-specific profile details', async () => {
    const user = userEvent.setup()
    await ready()
    expect(screen.getByText('Fictional profiles & sample rankings')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "View Omar Haddad's profile" }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('@demo_omar')).toBeInTheDocument()
    expect(within(dialog).getByText(/fictional demonstration profile/)).toBeInTheDocument()
    expect(within(dialog).queryByText('View on Kaggle')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('searches, shows no matches, and recovers by clearing filters', async () => {
    const user = userEvent.setup()
    await ready()
    await user.type(screen.getByRole('textbox', { name: 'Search Kagglers' }), 'nobody')
    expect(await screen.findByText('No Kagglers found')).toBeInTheDocument()
    expect(window.location.search).toContain('q=nobody')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('checkbox', { name: 'Compare Omar Haddad' })).toBeInTheDocument()
  })

  it('filters by city while retaining national rank and exports the same filter', async () => {
    const user = userEvent.setup()
    await ready()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by city' }), 'Irbid')
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Compare Omar Haddad' })).not.toBeInTheDocument())
    const row = screen.getByRole('checkbox', { name: 'Compare Sara Al-Khatib' }).closest('tr')!
    expect(within(row).getByRole('cell', { name: 'Jordan rank 2' })).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: 'Export filtered rankings as CSV' })).toHaveAttribute('href', expect.stringContaining('city=Irbid'))
  })

  it('changes category with arrow keys and requests its own scores', async () => {
    const user = userEvent.setup()
    await ready()
    screen.getByRole('tab', { name: 'Competitions' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Datasets' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Datasets' })).toHaveFocus()
    await waitFor(() => expect(requests.some(r => r.includes('/leaderboard?category=datasets'))).toBe(true))
  })

  it('requires two selected members and compares all four categories', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(screen.getByRole('checkbox', { name: 'Compare Omar Haddad' }))
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Compare Sara Al-Khatib' }))
    await user.click(screen.getByRole('button', { name: 'Compare' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Omar Haddad' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Sara Al-Khatib' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('heading', { name: 'Datasets' })).toHaveLength(2)
  })

  it('submits a nomination and reports that review is pending', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(screen.getAllByRole('button', { name: /Add a profile/ })[0])
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Kaggle username'), 'new_member')
    expect(within(dialog).getByLabelText('Public Kaggle profile')).toHaveValue('https://www.kaggle.com/new_member')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    expect(await within(dialog).findByText('You’re on the list.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Profile submitted for review/)).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /Compare/ })).toHaveLength(3)
  })

  it('preserves form input when the API rejects a duplicate nomination', async () => {
    submissionError = true
    const user = userEvent.setup()
    await ready()
    await user.click(screen.getAllByRole('button', { name: /Add a profile/ })[0])
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Kaggle username'), 'new_member')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already awaiting review')
    expect(within(dialog).getByLabelText('Kaggle username')).toHaveValue('new_member')
  })

  it('recovers from an API failure through retry', async () => {
    failing = true
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The API is unavailable.')
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('checkbox', { name: 'Compare Omar Haddad' })).toBeInTheDocument()
  })

  it('restores shareable category and city filters from the URL', async () => {
    window.history.replaceState(null, '', '/?category=datasets&city=Irbid#leaderboard')
    render(<App />)
    expect(await screen.findByRole('checkbox', { name: 'Compare Sara Al-Khatib' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Datasets' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: 'Filter by city' })).toHaveValue('Irbid')
    expect(screen.queryByRole('checkbox', { name: 'Compare Omar Haddad' })).not.toBeInTheDocument()
  })

  it('opens the community directory by default and includes unranked contributors', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByRole('button', { name: "View New Contributor's profile" })).toBeInTheDocument()
    expect(screen.getByText('Not ranked yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: 'Highest Kaggle tier' })).toContainElement(screen.getByRole('option', { name: 'Contributor' }))
  })

  it('filters to unranked community members and opens their profile without inventing a rank', async () => {
    window.history.replaceState(null, '', '/#community')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: "View New Contributor's profile" })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ranking status' }), 'unranked')
    await waitFor(() => expect(screen.queryByRole('button', { name: "View Omar Haddad's profile" })).not.toBeInTheDocument())
    expect(window.location.search).toContain('people_status=unranked')
    await user.click(screen.getByRole('button', { name: "View New Contributor's profile" }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByText('@new_contributor')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Not ranked in this category')).toHaveLength(4)
    expect(within(dialog).queryByText('#null')).not.toBeInTheDocument()
  })

  it('supports cities returned by the source and restores shared directory filters', async () => {
    window.history.replaceState(null, '', '/?people_city=Karak&people_status=unranked#community')
    render(<App />)
    expect(await screen.findByRole('button', { name: "View New Contributor's profile" })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Community city' })).toHaveValue('Karak')
    expect(screen.queryByRole('button', { name: "View Omar Haddad's profile" })).not.toBeInTheDocument()
  })

  it('searches the full community and clears an empty result', async () => {
    window.history.replaceState(null, '', '/#community')
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: "View New Contributor's profile" })
    await user.type(screen.getByRole('textbox', { name: 'Search community members' }), 'nobody')
    expect(await screen.findByText('No members match those filters.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear community filters' }))
    expect(await screen.findByRole('button', { name: "View New Contributor's profile" })).toBeInTheDocument()
  })
})
