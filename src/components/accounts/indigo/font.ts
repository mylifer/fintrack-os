import { Manrope } from 'next/font/google'

/** İndigo hesap sayfasının yazı tipi (demodaki Manrope). Türkçe karakterler
 *  için latin-ext alt kümesi şart. */
export const indigoFont = Manrope({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700', '800'] })
