/* ── Ekran görüntüsünden metin (OCR) ─────────────────────────────────────────
   Bazı bankalar dönem içi işlemleri yalnız uygulama ekranında gösterir.
   Ekran görüntüsü tarayıcıda tesseract.js ile okunur (görüntü hiçbir sunucuya
   gönderilmez). Motor, Türkçe dil verisi ve worker kendi alan adımızdan
   (public/ocr, scripts/copy-ocr-assets.mjs) yüklenir. Banka ayrıştırıcıları
   (kuveyt-period.ts …) yalnız buradaki SAF yapıyı görür: testler görüntüsüz,
   elle kurulmuş satırlarla çalışır. */

export interface OcrWord {
  text: string
  /** Sol / sağ kenar (piksel) */
  x0: number
  x1: number
}

export interface OcrLine {
  /** Üst kenar (piksel) — satırlar yukarıdan aşağıya */
  y: number
  text: string
  words: OcrWord[]
}

export interface OcrPage {
  /** Görüntü genişliği (piksel): sütunlar oranla bulunur */
  width: number
  lines: OcrLine[]
}

const BASE = '/ocr'

interface TessWord { text: string; bbox: { x0: number; x1: number } }
interface TessLine { text: string; bbox: { y0: number }; words: TessWord[] }
interface TessData { blocks: { paragraphs: { lines: TessLine[] }[] }[] | null }

/** Tarayıcıda görüntüden satırlar. tesseract.js yalnız burada, dinamik yüklenir. */
export async function readImageText(file: Blob): Promise<OcrPage> {
  const width = await imageWidth(file)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('tur', 1, {
    workerPath: `${BASE}/worker.min.js`,
    corePath: `${BASE}/core`,
    langPath: `${BASE}/lang`,
    workerBlobURL: false,
  })
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true })
    return { width, lines: toLines(data as unknown as TessData) }
  } catch {
    throw new Error('Görüntü okunamadı. Ekran görüntüsünü (PNG/JPG) yeniden deneyin.')
  } finally {
    await worker.terminate()
  }
}

export function toLines(data: TessData): OcrLine[] {
  const lines: OcrLine[] = []
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    const words = l.words.map(w => ({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1 })).filter(w => w.text)
    if (words.length) lines.push({ y: l.bbox.y0, text: words.map(w => w.text).join(' '), words })
  }
  return lines.sort((a, b) => a.y - b.y)
}

async function imageWidth(file: Blob): Promise<number> {
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width
    bmp.close()
    return w
  } catch {
    throw new Error('Görüntü açılamadı. PNG ya da JPG ekran görüntüsü yükleyin.')
  }
}
