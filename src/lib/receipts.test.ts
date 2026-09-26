import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { fitWithin, receiptFileError, receiptPath, RECEIPT_MAX_BYTES } from './receipts'

describe('receipts', () => {
  it('tür ve PDF boyutu doğrulaması', () => {
    expect(receiptFileError({ type: 'image/jpeg', size: 9_000_000 })).toBeNull()   // görsel küçültülecek
    expect(receiptFileError({ type: 'application/pdf', size: 1000 })).toBeNull()
    expect(receiptFileError({ type: 'application/pdf', size: RECEIPT_MAX_BYTES + 1 })).toMatch(/5 MB/)
    expect(receiptFileError({ type: 'image/heic', size: 1000 })).toMatch(/JPEG/)
    expect(receiptFileError({ type: 'text/html', size: 10 })).not.toBeNull()
  })

  it('en uzun kenar 1600 px, oran korunur; küçük görsel büyütülmez', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('yol kullanıcı klasörüyle başlar (Storage politikası buna bakar)', () => {
    expect(receiptPath('u1', 'tx9', 'image/jpeg', 'ab12')).toBe('u1/tx9-ab12.jpg')
    expect(receiptPath('u1', 'tx9', 'application/pdf', 'ab12')).toBe('u1/tx9-ab12.pdf')
  })
})
