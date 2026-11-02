export function normalizeText(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').trim().replace(/\s+/gu, ' ')
}

export function searchTerms(query: string): string[] {
  query = query.trim()
  const profile = query.match(/^(?:https?:\/\/)?(?:www\.)?kaggle\.com\/([a-zA-Z0-9_]{3,50})\/?(?:[?#].*)?$/i)
  if (profile) query = profile[1]
  else if (query.startsWith('@')) query = query.slice(1)
  return normalizeText(query).split(' ').filter(Boolean)
}

export function matchesPerson(person: { display_name: string; username: string; organization?: string }, terms: string[]): boolean {
  const fields = [person.display_name, person.username, person.organization || ''].map(normalizeText)
  return terms.every(term => fields.some(field => field.includes(term)))
}
