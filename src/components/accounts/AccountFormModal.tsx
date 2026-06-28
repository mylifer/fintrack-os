'use client'

import { useState } from 'react'
import { Modal }  from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { useAccountStore, useTransactionStore } from '@/store'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { computeTransactionEffect } from '@/lib/utils/calculations'
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

const COLORS = ['#111110','#1A5CA3','#1E7A3E','#B83232','#D4A853','#7B3F9B','#C4732A','#6B6B67']

const CONFIRM_WORD = 'Onaylıyorum'

export function AccountFormModal({ open, onClose, account, onDeleted }: AccountFormModalProps) {
  const { add, update, remove, recomputeBalances } = useAccountStore()

  const [name, setName]             = useState(account?.name ?? '')
  const [type, setType]             = useState<AccountType>(account?.type ?? 'checking')
  const [currency, setCurrency]     = useState<CurrencyCode>(account?.currency ?? 'TRY')
  const [balanceStr, setBalanceStr] = useState(
    account ? (account.type === 'credit_card' ? String(Math.abs(account.balance)) : String(account.balance)) : ''
  )
  const [color, setColor]           = useState(account?.color ?? '#1A5CA3')
  const [limitStr, setLimitStr]     = useState(account?.creditLimit ? String(account.creditLimit) : '')
  const [stmtDay, setStmtDay]       = useState(account?.statementDay ?? 1)
  const [icon, setIcon]             = useState(account?.icon ?? '')
  const [iconUrl, setIconUrl]       = useState('')
  const [loading, setLoading]       = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [confirmText, setConfirmText]         = useState('')

  const isCreditCard = type === 'credit_card'
  const canDelete    = confirmText === CONFIRM_WORD

  const txCount = account
    ? useTransactionStore.getState().transactions.filter(
        t => t.accountId === account.id || t.toAccountId === account.id,
      ).length
    : 0

  function applyUrl() {
    const url = iconUrl.trim()
    if (url) { setIcon(url); setIconUrl('') }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setIcon(ev.target?.result as string ?? '')
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleSubmit() {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Ad girin'
    if (isCreditCard && !parseCurrencyInput(limitStr)) e.limit = 'Limit girin'
    setErrors(e)
    if (Object.keys(e).length > 0) return

    setLoading(true)
    const desiredBalance = parseCurrencyInput(balanceStr) * (isCreditCard ? -1 : 1)

    const txs = useTransactionStore.getState().transactions
    const initialBalance = account
      ? desiredBalance - computeTransactionEffect(account.id, txs)
      : desiredBalance

    const data: Account = {
      id:           account?.id ?? crypto.randomUUID(),
      name:         name.trim(),
      type,
      currency,
      balance:      desiredBalance,
      initialBalance,
      color,
      icon:         icon || undefined,
      isArchived:   false,
      createdAt:    account?.createdAt ?? new Date().toISOString(),
      ...(isCreditCard && {
        creditLimit:  parseCurrencyInput(limitStr),
        statementDay: stmtDay,
        dueDay:       account?.dueDay ?? 10,
        minPayPct:    account?.minPayPct ?? 3,
      }),
    }

    if (account) { await update(account.id, data) }
    else         { await add(data) }

    recomputeBalances(txs)
    setLoading(false)
    onClose()
  }

  async function handleDelete() {
    if (!account || !canDelete) return
    setLoading(true)
    await remove(account.id)
    setLoading(false)
    setShowDeleteModal(false)
    onClose()
    onDeleted?.()
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

          <div className="grid grid-cols-2 gap-3">
            <Select label="Para Birimi" value={currency} onChange={e => setCurrency(e.target.value as CurrencyCode)} options={CURRENCY_OPTIONS} />
            <CurrencyInput
              label={isCreditCard ? 'Güncel Borç' : 'Güncel Bakiye'}
              value={balanceStr}
              onChange={setBalanceStr}
              currency={currency}
            />
          </div>

          {isCreditCard && (
            <>
              <CurrencyInput label="Kredi Limiti" value={limitStr} onChange={setLimitStr} currency={currency} error={errors.limit} />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Ekstre Kesim Günü</label>
                <input
                  type="number" min={1} max={28}
                  value={stmtDay}
                  onChange={e => setStmtDay(Number(e.target.value))}
                  className="w-full border border-border px-3 py-2.5 text-sm font-mono bg-background dark:bg-muted focus:border-ink outline-none"
                />
              </div>
            </>
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
                  URL'den Çek
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
