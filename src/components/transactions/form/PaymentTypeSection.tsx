'use client'

import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/subscriptions/BrandLogo'
import { cn } from '@/lib/utils'
import { InstallmentEditor, type InstallmentEditorProps, type InstallmentEditorSetters } from './InstallmentEditor'
import type { PaymentType } from './usePaymentType'

// Ödeme tipi — abonelik + taksit tek segmentte.
export function PaymentTypeSection({
  installmentLocked, convertibleTx, payType, payTypeOptions, selectPayType, subBrand,
  form, amountStr, accounts, errors, setErrors, installments, setInstallments, manualAmounts, setManualAmounts,
}: Pick<PaymentType,
  'installmentLocked' | 'convertibleTx' | 'payType' | 'payTypeOptions' | 'selectPayType' | 'subBrand'
> & InstallmentEditorProps & InstallmentEditorSetters) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Ödeme tipi</Label>
        {installmentLocked ? (
          <span className="text-xs text-muted-foreground">
            Değişiklik tüm taksitlere uygulanır
          </span>
        ) : convertibleTx && form.isInstallment ? (
          <span className="text-xs text-muted-foreground">
            Bu işlem 1. taksit olur
          </span>
        ) : null}
      </div>

      <div className={cn(
        "grid gap-1 rounded-lg bg-muted p-1",
        payTypeOptions.length === 3 ? "grid-cols-3" : "grid-cols-2",
      )}>
        {payTypeOptions.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            disabled={installmentLocked}
            aria-pressed={payType === key}
            onClick={() => selectPayType(key)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all",
              payType === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              installmentLocked && "cursor-default",
            )}
          >
            <Icon className={cn("size-3.5", payType === key && "text-primary")} />
            {label}
          </button>
        ))}
      </div>

      {/* Abonelik detayı — marka açıklamadan tanınır. */}
      {payType === 'subscription' && (
        <div className="rounded-lg border border-dashed p-4">
          {subBrand ? (
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BrandLogo brand={subBrand} name={subBrand.name} size={20} />
              {subBrand.name} olarak tanındı — Abonelikler sayfasında görünür.
            </span>
          ) : (
            <p className="text-xs text-muted-foreground">
              Marka otomatik tanınacak — Abonelikler sayfasında görünür.
            </p>
          )}
        </div>
      )}

      {/* Taksit detayı — sayı + taksit tutarları (elle düzenlenebilir). */}
      {form.isInstallment && (
        <InstallmentEditor
          form={form}
          amountStr={amountStr}
          accounts={accounts}
          errors={errors}
          setErrors={setErrors}
          installments={installments}
          setInstallments={setInstallments}
          manualAmounts={manualAmounts}
          setManualAmounts={setManualAmounts}
        />
      )}
    </div>
  )
}
