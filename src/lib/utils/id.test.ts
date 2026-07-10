import { describe, it, expect } from 'vitest'
import { deterministicUuid } from './id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('deterministicUuid (recurring idempotency, M2)', () => {
  it('is stable for the same seed', () => {
    const seed = 'recur:abc-123:2026-02-01'
    expect(deterministicUuid(seed)).toBe(deterministicUuid(seed))
  })
  it('produces a valid uuid-v4 format', () => {
    expect(deterministicUuid('x')).toMatch(UUID_V4)
    expect(deterministicUuid('recur:template:2026-01-01')).toMatch(UUID_V4)
  })
  it('differs for different seeds', () => {
    expect(deterministicUuid('a')).not.toBe(deterministicUuid('b'))
    expect(deterministicUuid('recur:t:2026-01-01')).not.toBe(deterministicUuid('recur:t:2026-02-01'))
  })
})
