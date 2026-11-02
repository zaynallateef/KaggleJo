import { describe, expect, it } from 'vitest'
import { matchesPerson, searchTerms } from '../search'

describe('people search', () => {
  const person = { username: 'loplop05', display_name: 'SÁRA   خَالِد', organization: 'Jordan University' }
  it('accepts handles and Kaggle profile links', () => {
    for (const query of ['@LOPLOP05', 'https://www.kaggle.com/loplop05/', 'kaggle.com/loplop05?tab=activity']) {
      expect(matchesPerson(person, searchTerms(query))).toBe(true)
    }
  })
  it('matches accented and Arabic names, and multiple words in either order', () => {
    for (const query of ['sara', 'خالد', 'خالد sara', 'University sara']) expect(matchesPerson(person, searchTerms(query))).toBe(true)
    expect(matchesPerson(person, searchTerms('sara nobody'))).toBe(false)
  })
  it('keeps special characters literal and does not join separate fields', () => {
    expect(matchesPerson(person, searchTerms('%'))).toBe(false)
    expect(matchesPerson(person, searchTerms('خالدloplop'))).toBe(false)
  })
})
