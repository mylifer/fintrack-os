import { describe, it, expect } from 'vitest'
import { createSerialQueue } from './serial-queue'

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('createSerialQueue', () => {
  it('işler araya girmeden sırayla biter (yavaş ilk iş sonrakini ezemez)', async () => {
    const enqueue = createSerialQueue()
    const log: string[] = []
    let value = 0
    const a = enqueue(async () => { log.push('a1'); await tick(20); value = 21; log.push('a2') })
    const b = enqueue(async () => { log.push('b1'); value = 16; log.push('b2') })
    await Promise.all([a, b])
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(value).toBe(16)
  })

  it('hata kuyruğu durdurmaz, yalnız o işin sözünü reddeder', async () => {
    const enqueue = createSerialQueue()
    const failed = enqueue(async () => { throw new Error('x') })
    const ok = enqueue(async () => 'tamam')
    await expect(failed).rejects.toThrow('x')
    await expect(ok).resolves.toBe('tamam')
  })
})
