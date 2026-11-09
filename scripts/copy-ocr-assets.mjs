// Görüntüden okuma (tesseract.js) dosyalarını public/ocr'a kopyalar: tarayıcı
// bunları kendi alan adımızdan yükler (CDN yok, CSP 'self'). dev/build öncesi
// otomatik çalışır; public/ocr git'e girmez.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const out = join(process.cwd(), 'public', 'ocr')
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`))

mkdirSync(join(out, 'core'), { recursive: true })
mkdirSync(join(out, 'lang'), { recursive: true })

copyFileSync(join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
// Yalnız LSTM motoru kullanılıyor; tarayıcı SIMD desteğine göre birini seçer
const core = pkgDir('tesseract.js-core')
for (const f of readdirSync(core)) if (/^tesseract-core.*-lstm\.(js|wasm|wasm\.js)$/.test(f)) copyFileSync(join(core, f), join(out, 'core', f))
copyFileSync(join(pkgDir('@tesseract.js-data/tur'), '4.0.0_best_int', 'tur.traineddata.gz'), join(out, 'lang', 'tur.traineddata.gz'))
console.log('[ocr] public/ocr hazır')
