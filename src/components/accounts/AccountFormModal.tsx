'use client'

import { useMemo, useState } from 'react'
import { Modal }  from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { useAccountStore, useTransactionStore, usePaymentsStore } from '@/store'
import { planIdFor } from '@/lib/payments/ids'
import { parseCurrencyInput, formatCurrency, formatNumberForInput } from '@/lib/utils/currency'
import { computeTransactionEffect, excludeFuture } from '@/lib/utils/calculations'
import { DEFAULT_DEPOSIT_TAX, projectDeposit } from '@/lib/utils/deposit'
import { today } from '@/lib/utils/date'
import { addDays, format, parseISO } from 'date-fns'
import type { Account, AccountType, CurrencyCode } from '@/types'

interface AccountFormModalProps {
  open: boolean
  onClose: () => void
  account?: Account
  onDeleted?: () => void
}

const TYPE_OPTIONS = [
  { value: 'cash',        label: 'Nakit' },
  { value: 'checking',    label: 'Vadesiz Hesap' },
  { value: 'savings',     label: 'Vadeli Hesap' },
  { value: 'credit_card', label: 'Kredi Kartı' },
  { value: 'investment',  label: 'Yatırım Hesabı' },
  { value: 'loan',        label: 'Kredi / Borç' },
]

const CURRENCY_OPTIONS = [
  { value: 'TRY', label: '₺ Türk Lirası' },
  { value: 'USD', label: '$ Amerikan Doları' },
  { value: 'EUR', label: '€ Euro' },
  { value: 'GBP', label: '£ İngiliz Sterlini' },
]

// Bankaların sık kullandığı vade süreleri (gün)
const DEPOSIT_TERMS = [32, 92, 181, 365]

const COLORS = ['#111110','#1A5CA3','#1E7A3E','#B83232','#D4A853','#7B3F9B','#C4732A','#6B6B67']

const CONFIRM_WORD = 'Onaylıyorum'

export function AccountFormModal({ open, onClose, account, onDeleted }: AccountFormModalProps) {
  const add               = useAccountStore(s => s.add)
  const update            = useAccountStore(s => s.update)
  const remove            = useAccountStore(s => s.remove)
  const recomputeBalances = useAccountStore(s => s.recomputeBalances)

  // Kredi kartı borcu pozitif girilir (DB'de negatif tutulur); diğer hesap
  // türlerinde işaret korunur — abs almak negatif açılış bakiyesini bozar
  const initialBalanceDisplay = (a?: Account) =>
    a ? formatNumberForInput(a.type === 'credit_card' ? Math.abs(a.initialBalance) : a.initialBalance) : ''

  // Fresh instance per open (mount is keyed + conditional on `open` at both call
  // sites) → lazy initializers seed straight from the `account` prop; no
  // reset-on-open effect needed.
  const [name, setName]               = useState(() => account?.name ?? '')
  const [type, setType]               = useState<AccountType>(() => account?.type ?? 'checking')
  const [currency, setCurrency]       = useState<CurrencyCode>(() => account?.currency ?? 'TRY')
  const [initialBalStr, setInitialBalStr] = useState(() => initialBalanceDisplay(account))
  const [color, setColor]             = useState(() => account?.color ?? '#1A5CA3')
  const [limitStr, setLimitStr]     = useState(() => account?.creditLimit ? formatNumberForInput(account.creditLimit) : '')
  const [stmtDay, setStmtDay]       = useState(() => account?.statementDay ?? 1)
  // Son ödeme günü kartın ödeme PLANINDA tutulur (Ödeme Takibi ve ekstre ikisi
  // de oradan okur). account.dueDay güvenilmez: her karta 10 yazılıyordu.
  const cardPlan = usePaymentsStore(s => account ? s.plans.find(p => p.id === planIdFor('card', account.id)) : undefined)
  const savePlan = usePaymentsStore(s => s.savePlan)
  const [dueDayStr, setDueDayStr]   = useState(() => cardPlan?.dayOfMonth ? String(cardPlan.dayOfMonth) : '')
  // %3 eski formun her karta yazdığı varsayılandı (Türkiye'de oran %20/%40) —
  // kullanıcı girmiş sayılmaz, alan boş gelir.
  const [minPctStr, setMinPctStr]   = useState(() => account?.minPayPct && account.minPayPct !== 3 ? String(account.minPayPct) : '')
  // Vadeli mevduat koşulları (yalnız 'savings'); boş bırakılırsa hiç yazılmaz
  const [depRateStr, setDepRateStr] = useState(() => account?.depositRate ? String(account.depositRate).replace('.', ',') : '')
  const [depTaxStr, setDepTaxStr]   = useState(() => account?.depositTaxPct != null ? String(account.depositTaxPct).replace('.', ',') : '')
  const [depStart, setDepStart]     = useState(() => account?.depositStart ?? '')
  const [depEnd, setDepEnd]         = useState(() => account?.depositEnd ?? '')
  const [icon, setIcon]             = useState(() => account?.icon ?? '')
  const [iconUrl, setIconUrl]       = useState('')
  const [loading, setLoading]       = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [confirmText, setConfirmText]         = useState('')

  const isCreditCard = type === 'credit_card'
  const isSavings    = type === 'savings'
  const canDelete    = confirmText === CONFIRM_WORD

  const txs            = useTransactionStore(s => s.transactions)
  const txCount = useMemo(
    () => account
      ? txs.filter(t => t.accountId === account.id || t.toAccountId === account.id).length
      : 0,
    [txs, account],
  )

  function applyUrl() {
    const url = iconUrl.trim()
    if (url) { setIcon(url); setIconUrl('') }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result
      setIcon(typeof result === 'string' ? result : '')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Gelecek tarihli işlemler güncel bakiyeye dahil değil (store ile aynı kural)
  const txEffect       = account ? computeTransactionEffect(account, excludeFuture(txs)) : 0
  const initialBalNum  = isCreditCard
    ? -Math.abs(parseCurrencyInput(initialBalStr))   // borç her zaman negatif tutulur
    : parseCurrencyInput(initialBalStr)              // işaret kullanıcının girdiği gibi
  const computedBalance = initialBalNum + txEffect

  const depRate     = parseCurrencyInput(depRateStr)
  const depTax      = depTaxStr.trim() ? parseCurrencyInput(depTaxStr) : DEFAULT_DEPOSIT_TAX
  const depositUsed = isSavings && !!(depRateStr.trim() || depStart || depEnd)
  const depositOk   = depRate > 0 && !!depStart && !!depEnd && depEnd > depStart
  const depPreview  = depositUsed && depositOk
    ? projectDeposit(computedBalance, { rate: depRate, start: depStart, end: depEnd, taxPct: depTax }, today())
    : null
  const hadDeposit  = !!(account?.depositRate || account?.depositStart || account?.depositEnd)

  function setTermDays(days: number) {
    const start = depStart || today()
    setDepStart(start)
    setDepEnd(format(addDays(parseISO(start), days), 'yyyy-MM-dd'))
  }

  async function handleSubmit() {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Ad girin'
    if (isCreditCard && !parseCurrencyInput(limitStr)) e.limit = 'Limit girin'
    if (depositUsed && !depositOk) e.deposit = 'Faiz oranı, vade başlangıcı ve (başlangıçtan sonraki) vade sonu gerekli'
    setErrors(e)
    if (Object.keys(e).length > 0) return

    setLoading(true)
    try {
    const initialBalance = initialBalNum
    const balance        = computedBalance

    const data: Account = {
      id:           account?.id ?? crypto.randomUUID(),
      name:         name.trim(),
      type,
      currency,
      balance,
      initialBalance,
      color,
      icon:         icon || undefined,
      isArchived:   false,
      createdAt:    account?.createdAt ?? new Date().toISOString(),
      ...(isCreditCard && {
        creditLimit:  parseCurrencyInput(limitStr),
        statementDay: stmtDay,
        dueDay:       account?.dueDay ?? 10,
        minPayPct:    parseCurrencyInput(minPctStr) || undefined,
      }),
      // Vade sütunları (0018) yalnız koşul girildiğinde ya da eskisi silinirken
      // yazılır — hiç vade kullanmayan hesap bu sütunlara hiç dokunmaz.
      ...((depositUsed || hadDeposit) && {
        depositRate:   depositUsed ? depRate : null,
        depositStart:  depositUsed ? depStart : null,
        depositEnd:    depositUsed ? depEnd : null,
        depositTaxPct: depositUsed ? depTax : null,
      }),
    }

    if (account) { await update(account.id, data) }
    else         { await add(data) }

    // Son ödeme günü plana yazılır; değişmediyse (ya da plan yokken boş
    // bırakıldıysa) plana dokunulmaz — Ödeme Takibi gereksiz plan açmasın.
    if (isCreditCard) {
      const day = Math.round(Number(dueDayStr))
      const nextDay = day >= 1 && day <= 31 ? day : null
      if (nextDay !== (cardPlan?.dayOfMonth ?? null)) await savePlan('card', data.id, { dayOfMonth: nextDay })
    }

    recomputeBalances(useTransactionStore.getState().transactions)
    onClose()
    } catch (err) {
      console.error('[account:save]', err)
      setErrors({ name: 'Kaydetme başarısız oldu, tekrar deneyin' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!account || !canDelete) return
    setLoading(true)
    try {
      await remove(account.id)
      setShowDeleteModal(false)
      onClose()
      onDeleted?.()
    } catch (err) {
      console.error('[account:delete]', err)
    } finally {
      setLoading(false)
    }
  }

  function openDeleteModal() {
    setConfirmText('')
    setShowDeleteModal(true)
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={account ? 'Hesabı Düzenle' : 'Yeni Hesap'} size="md">
        <div className="flex flex-col gap-4">
          <Input label="Hesap Adı" value={name} onChange={e => setName(e.target.value)} error={errors.name} placeholder="Yapı Kredi Platinum" />

          <Select label="Tür" value={type} onChange={e => setType(e.target.value as AccountType)} options={TYPE_OPTIONS} />

          {/* İşlemi olan hesabın para birimi değiştirilemez: bakiye ve gelir/gider
              tutarları hesabın kendi biriminde toplanır (computeTransactionEffect);
              mevcut işlemler dönüştürülmeden birim değişince 1.000 $ sessizce
              1.000 ₺ oluyordu. */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Para Birimi"
              value={currency}
              onChange={e => setCurrency(e.target.value as CurrencyCode)}
              options={CURRENCY_OPTIONS}
              disabled={txCount > 0}
            />
            <CurrencyInput
              label={isCreditCard ? 'Açılış Borcu' : 'Açılış Bakiyesi'}
              value={initialBalStr}
              onChange={setInitialBalStr}
              currency={currency}
            />
          </div>
          {txCount > 0 && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Bu hesabın işlemleri olduğu için para birimi değiştirilemez.
            </p>
          )}

          {account && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border/60">
              <span className="text-xs text-muted-foreground">
                {isCreditCard ? 'Güncel Borç' : 'Güncel Bakiye'}
              </span>
              <span className={`text-sm font-semibold tabular-nums ${computedBalance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {computedBalance < 0 ? '−' : ''}{formatCurrency(Math.abs(computedBalance), currency)}
              </span>
            </div>
          )}

          {isCreditCard && (
            <>
              <CurrencyInput label="Kredi Limiti" value={limitStr} onChange={setLimitStr} currency={currency} error={errors.limit} />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Ekstre Kesim Günü</label>
                <input
                  type="number" min={1} max={31}
                  value={stmtDay}
                  onChange={e => setStmtDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-full border border-border px-3 py-2.5 text-sm font-mono bg-background dark:bg-muted focus:border-ink outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Son Ödeme Günü"
                  type="number"
                  min={1}
                  max={31}
                  value={dueDayStr}
                  onChange={e => setDueDayStr(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="Örn. 25"
                  hint="Ekstre ve Ödeme Takibi bu günü kullanır"
                />
                <Input
                  label="Asgari Ödeme (%)"
                  inputMode="decimal"
                  value={minPctStr}
                  onChange={e => setMinPctStr(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="Örn. 20"
                  hint="Ekstrenizdeki oran (çoğu kartta %20 ya da %40)"
                />
              </div>
            </>
          )}

          {isSavings && (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 p-3">
              <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                Vade Koşulları <span className="normal-case font-normal">(isteğe bağlı)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Yıllık Faiz (%)"
                  inputMode="decimal"
                  value={depRateStr}
                  onChange={e => setDepRateStr(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="Örn. 42"
                  hint="Brüt, bankanın verdiği oran"
                />
                <Input
                  label="Stopaj (%)"
                  inputMode="decimal"
                  value={depTaxStr}
                  onChange={e => setDepTaxStr(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder={String(DEFAULT_DEPOSIT_TAX).replace('.', ',')}
                  hint="Boşsa %17,5"
                />
                <Input label="Vade Başlangıcı" type="date" value={depStart} onChange={e => setDepStart(e.target.value)} />
                <Input label="Vade Sonu" type="date" value={depEnd} onChange={e => setDepEnd(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">Süre:</span>
                {DEPOSIT_TERMS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTermDays(d)}
                    className="px-2 h-6 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
                  >{d} gün</button>
                ))}
              </div>
              {errors.deposit && <p className="text-xs text-destructive">{errors.deposit}</p>}
              {depPreview && (
                <p className="text-xs text-muted-foreground">
                  {depPreview.days} gün · tahmini net faiz{' '}
                  <span className="font-semibold text-foreground">{formatCurrency(depPreview.net, currency)}</span>
                  {' '}(brüt {formatCurrency(depPreview.gross, currency)}, stopaj {formatCurrency(depPreview.tax, currency)}) —
                  anapara güncel bakiye
                </p>
              )}
            </div>
          )}

          {/* Color picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Renk</label>
            <div className="flex gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 flex-shrink-0 transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-ink' : 'hover:scale-110'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Custom icon */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
              Hesap Görseli <span className="normal-case font-normal">(isteğe bağlı)</span>
            </label>

            {icon ? (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card">
                <div className="w-10 h-10 rounded-xl overflow-hidden border border-border bg-card flex items-center justify-center p-1 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dış/kullanıcı kaynaklı küçük ikon (data: URL ya da favicon); next/image optimizasyonu bu kaynaklara uygulanamaz */}
                  <img
                    src={icon}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                    onError={() => setIcon('')}
                  />
                </div>
                <span className="text-xs text-muted-foreground flex-1 truncate min-w-0">
                  {icon.startsWith('data:') ? 'Yüklenen görsel' : icon}
                </span>
                <button
                  onClick={() => setIcon('')}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  Kaldır
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="url"
                  value={iconUrl}
                  onChange={e => setIconUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyUrl() }}
                  placeholder="https://bank.com/logo.png"
                  className="flex-1 min-w-0 border border-border px-3 py-2.5 text-xs bg-background dark:bg-muted focus:border-ink outline-none"
                />
                <button
                  onClick={applyUrl}
                  disabled={!iconUrl.trim()}
                  className="px-3 py-2.5 text-xs font-semibold border border-border hover:bg-accent disabled:opacity-40 transition-colors flex-shrink-0"
                >
                  URL&apos;den Çek
                </button>
                <label className="px-3 py-2.5 text-xs font-semibold border border-border hover:bg-accent cursor-pointer transition-colors flex-shrink-0">
                  Yükle
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={handleSubmit} loading={loading} fullWidth>Kaydet</Button>
            <Button variant="secondary" onClick={onClose} fullWidth>İptal</Button>
          </div>

          {account && (
            <div className="pt-3 border-t border-border">
              <button
                onClick={openDeleteModal}
                className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
              >
                Hesabı Sil
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Hard delete confirmation modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Hesabı Kalıcı Olarak Sil"
        size="sm"
      >
        <div className="flex flex-col gap-5">
          {/* Warning */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive font-medium mb-1">Bu işlem geri alınamaz</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Bu hesabı ve ona bağlı olan tüm işlemleri (harcamalar, transferler vb.) kalıcı olarak silmek üzeresiniz. Bu işlem kesinlikle geri alınamaz.
            </p>
          </div>

          {txCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Bu hesaba bağlı <span className="font-semibold text-destructive">{txCount} işlem</span> de birlikte silinecek.
            </p>
          )}

          {/* Confirmation input */}
          <div className="flex flex-col gap-2">
            <Input
              label={`İşlemi onaylamak için kutucuğa "${CONFIRM_WORD}" yazın`}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={loading}
              disabled={!canDelete}
              fullWidth
            >
              Kalıcı Olarak Sil
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowDeleteModal(false)}
              fullWidth
            >
              Vazgeç
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
