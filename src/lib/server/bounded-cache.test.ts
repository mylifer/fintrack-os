import { describe, it, expect } from 'vitest'
import { BoundedCache } from './bounded-cache'

describe('BoundedCache', () => {
  it('kapasiteye kadar normal bir Map gibi davranır', () => {
    const c = new BoundedCache<number>(3)
    c.set('a', 1); c.set('b', 2); c.set('c', 3)

    expect(c.size).toBe(3)
    expect(c.get('a')).toBe(1)
    expect(c.get('c')).toBe(3)
    expect(c.has('b')).toBe(true)
    expect(c.get('yok')).toBeUndefined()
  })

  it('kapasite aşılınca EN ESKİ girdiyi atar', () => {
    const c = new BoundedCache<number>(3)
    c.set('a', 1); c.set('b', 2); c.set('c', 3)
    c.set('d', 4)

    expect(c.size).toBe(3)
    expect(c.has('a')).toBe(false)   // en eski düştü
    expect(c.has('b')).toBe(true)
    expect(c.has('d')).toBe(true)
  })

  it('sınırsız yazma altında boyut TAVANI aşmaz (F5 regresyon koruması)', () => {
    const c = new BoundedCache<number>(50)
    // Saldırgan senaryosu: benzersiz anahtarlarla sürekli yazma
    for (let i = 0; i < 10_000; i++) c.set(`key-${i}`, i)

    expect(c.size).toBe(50)
    expect(c.has('key-0')).toBe(false)
    expect(c.has('key-9999')).toBe(true)
  })

  it('var olan anahtarı yeniden yazmak boyutu artırmaz ve onu sona taşır', () => {
    const c = new BoundedCache<number>(3)
    c.set('a', 1); c.set('b', 2); c.set('c', 3)

    c.set('a', 99)          // 'a' artık en YENİ
    expect(c.size).toBe(3)
    expect(c.get('a')).toBe(99)

    c.set('d', 4)           // en eski artık 'b'
    expect(c.has('b')).toBe(false)
    expect(c.get('a')).toBe(99)   // sıcak girdi hayatta kaldı
    expect(c.has('d')).toBe(true)
  })

  it('kapasitedeyken var olan anahtarı güncellemek onu tahliye etmez', () => {
    const c = new BoundedCache<number>(2)
    c.set('a', 1); c.set('b', 2)
    c.set('b', 22)

    expect(c.size).toBe(2)
    expect(c.get('b')).toBe(22)
    expect(c.get('a')).toBe(1)
  })

  it('delete girdiyi kaldırır ve yer açar', () => {
    const c = new BoundedCache<number>(2)
    c.set('a', 1); c.set('b', 2)

    expect(c.delete('a')).toBe(true)
    expect(c.delete('a')).toBe(false)
    expect(c.size).toBe(1)

    c.set('c', 3)
    expect(c.has('b')).toBe(true)   // tahliye gerekmedi
    expect(c.has('c')).toBe(true)
  })

  it('max = 1 ile yalnızca son girdiyi tutar', () => {
    const c = new BoundedCache<number>(1)
    c.set('a', 1); c.set('b', 2)

    expect(c.size).toBe(1)
    expect(c.has('a')).toBe(false)
    expect(c.get('b')).toBe(2)
  })

  it('geçersiz kapasiteyi reddeder', () => {
    expect(() => new BoundedCache<number>(0)).toThrow()
  })
})
