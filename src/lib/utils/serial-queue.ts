/* Sıralı iş kuyruğu: verilen async işleri sırayla, bir öncekinin bitmesini
   bekleyerek çalıştırır. Birden çok adımlı kayıtlar (ör. Kart Takvimi'nde kesim
   günü → fark → son ödeme planı) arka arkaya tetiklendiğinde adımlar araya
   girmez; aksi halde geç biten eski kayıt yeni değeri ezer. Bir işin hatası
   kuyruğu durdurmaz, yalnız o işin sözünü reddeder. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}
