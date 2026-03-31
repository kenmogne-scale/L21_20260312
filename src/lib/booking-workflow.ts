import { differenceInDays, format } from 'date-fns'

import type { AllocationEntry } from '@/lib/availability'
import { type CreateInvoicePayload } from '@/lib/lexoffice'
import type { Booking, BookingStatus, Customer } from '@/lib/types'

export type InvoiceLineItem = AllocationEntry & {
  requestId: string
  positionNumber: number
  locationName: string
  checkIn: string
  checkOut: string
}

export type DraftInvoiceState = {
  id: string
  voucherNumber?: string
  voucherStatus?: string
  lexofficeUrl: string
}

export type InvoiceDraftLine = {
  id: string
  kind: 'booking' | 'cleaning' | 'custom' | 'text'
  sourceKey?: string
  propertyId?: string
  requestId?: string
  positionNumber?: number
  name: string
  description: string
  quantity: number
  unitName: string
  unitPriceNet: number
  discountPercentage: number
  taxRate: 0 | 7 | 19
}

export type InvoiceFormState = {
  customerName: string
  addressSupplement: string
  street: string
  zip: string
  city: string
  countryCode: string
  voucherDate: string
  serviceDateFrom: string
  serviceDateTo: string
  title: string
  introduction: string
  remark: string
  paymentTermDays: number
  totalDiscountPercentage: number
  lines: InvoiceDraftLine[]
}

export type InvoiceLineTotal = {
  id: string
  sourceKey?: string
  linkedBooking: boolean
  netAfterLineDiscount: number
  discountShare: number
  netAfterTotalDiscount: number
  taxAmount: number
  grossAmount: number
}

export type InvoiceTotals = {
  lineTotals: InvoiceLineTotal[]
  totalNet: number
  totalTax: number
  totalGross: number
  totalDiscountAmount: number
}

export type BookingInsertInput = Omit<Booking, 'id' | 'bookingNumber' | 'createdAt' | 'updatedAt'>

export function formatRange(checkIn: string, checkOut: string) {
  return `${format(new Date(checkIn), 'dd.MM.yyyy')} - ${format(new Date(checkOut), 'dd.MM.yyyy')}`
}

export function toLexofficeDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const millis = String(date.getMilliseconds()).padStart(3, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const offsetHours = pad(Math.floor(absoluteOffset / 60))
  const offsetRemainder = pad(absoluteOffset % 60)

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetRemainder}`
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

export function createInvoiceDraftLineId() {
  return `draft-line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function inferCountryCode(customer?: Customer) {
  const rawCountry = customer?.country?.trim().toLowerCase()
  if (!rawCountry || rawCountry === 'de' || rawCountry === 'deutschland' || rawCountry === 'germany') return 'DE'
  return customer?.country?.slice(0, 2).toUpperCase() || 'DE'
}

export function createInitialInvoiceForm(args: {
  customer: Customer | undefined
  invoiceLines: InvoiceLineItem[]
  notes: string
  defaultTaxRate: 0 | 7 | 19
  totalDiscountPercentage: number
  fallbackCountryCode: string
}) {
  const { customer, invoiceLines, notes, defaultTaxRate, totalDiscountPercentage, fallbackCountryCode } = args
  const today = new Date().toISOString().slice(0, 10)
  const serviceDates = invoiceLines
    .flatMap(line => [line.checkIn, line.checkOut])
    .filter(Boolean)
    .sort()

  const lines: InvoiceDraftLine[] = invoiceLines.flatMap(line => {
    const sourceKey = `${line.requestId}:${line.propertyId}`
    const bookingLine: InvoiceDraftLine = {
      id: createInvoiceDraftLineId(),
      kind: 'booking',
      sourceKey,
      propertyId: line.propertyId,
      requestId: line.requestId,
      positionNumber: line.positionNumber,
      name: line.shortCode || line.propertyName,
      description: `${line.propertyName}, ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}, ${line.bedsAllocated} Betten`,
      quantity: line.nights,
      unitName: line.bedsAllocated === 1 ? 'Nacht' : 'Nächte',
      unitPriceNet: roundCurrency(line.pricePerBedNight * line.bedsAllocated),
      discountPercentage: 0,
      taxRate: defaultTaxRate,
    }

    const cleaningLine = line.cleaningFee > 0
      ? [{
          id: createInvoiceDraftLineId(),
          kind: 'cleaning' as const,
          sourceKey,
          propertyId: line.propertyId,
          requestId: line.requestId,
          positionNumber: line.positionNumber,
          name: `${line.shortCode || line.propertyName} - Endreinigung`,
          description: `${line.propertyName}, ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}`,
          quantity: 1,
          unitName: 'Pauschale',
          unitPriceNet: roundCurrency(line.cleaningFee),
          discountPercentage: 0,
          taxRate: defaultTaxRate,
        }]
      : []

    return [bookingLine, ...cleaningLine]
  })

  return {
    customerName: customer?.companyName ?? '',
    addressSupplement: customer?.firstName || customer?.lastName ? `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() : '',
    street: customer?.address ?? '',
    zip: customer?.zip ?? '',
    city: customer?.city ?? '',
    countryCode: fallbackCountryCode,
    voucherDate: today,
    serviceDateFrom: serviceDates[0] ?? today,
    serviceDateTo: serviceDates.at(-1) ?? serviceDates[0] ?? today,
    title: 'Rechnung',
    introduction: customer?.companyName ? `Rechnung für ${customer.companyName}` : 'Rechnung',
    remark: notes.trim(),
    paymentTermDays: 14,
    totalDiscountPercentage,
    lines,
  } satisfies InvoiceFormState
}

function lineTotalsSoFar(
  lineSummaries: Array<{ netAfterLineDiscount: number }>,
  totalDiscountAmount: number,
  limit: number,
) {
  if (limit <= 0) return 0
  const netBeforeTotalDiscount = lineSummaries.reduce((sum, line) => sum + line.netAfterLineDiscount, 0)
  let running = 0
  for (let index = 0; index < limit; index += 1) {
    const line = lineSummaries[index]
    running += netBeforeTotalDiscount > 0
      ? roundCurrency(totalDiscountAmount * (line.netAfterLineDiscount / netBeforeTotalDiscount))
      : 0
  }
  return roundCurrency(running)
}

export function calculateInvoiceFormTotals(lines: InvoiceDraftLine[], totalDiscountPercentage: number): InvoiceTotals {
  const pricedLines = lines.filter(line => line.kind !== 'text')
  const lineSummaries = pricedLines.map(line => {
    const grossBase = line.quantity * line.unitPriceNet
    const discountFactor = 1 - line.discountPercentage / 100
    const netAfterLineDiscount = roundCurrency(grossBase * discountFactor)
    return {
      id: line.id,
      sourceKey: line.sourceKey,
      netAfterLineDiscount,
      taxRate: line.taxRate,
      linkedBooking: line.kind === 'booking' || line.kind === 'cleaning',
    }
  })

  const netBeforeTotalDiscount = roundCurrency(lineSummaries.reduce((sum, line) => sum + line.netAfterLineDiscount, 0))
  const totalDiscountAmount = roundCurrency(netBeforeTotalDiscount * totalDiscountPercentage / 100)

  const lineTotals = lineSummaries.map((line, index) => {
    const proportionalDiscount = netBeforeTotalDiscount > 0
      ? roundCurrency(totalDiscountAmount * (line.netAfterLineDiscount / netBeforeTotalDiscount))
      : 0
    const isLast = index === lineSummaries.length - 1
    const discountShare = isLast
      ? roundCurrency(totalDiscountAmount - lineTotalsSoFar(lineSummaries, totalDiscountAmount, index))
      : proportionalDiscount
    const netAfterTotalDiscount = roundCurrency(Math.max(0, line.netAfterLineDiscount - discountShare))
    const taxAmount = roundCurrency(netAfterTotalDiscount * line.taxRate / 100)

    return {
      id: line.id,
      sourceKey: line.sourceKey,
      linkedBooking: line.linkedBooking,
      netAfterLineDiscount: line.netAfterLineDiscount,
      discountShare,
      netAfterTotalDiscount,
      taxAmount,
      grossAmount: roundCurrency(netAfterTotalDiscount + taxAmount),
    }
  })

  const totalNet = roundCurrency(lineTotals.reduce((sum, line) => sum + line.netAfterTotalDiscount, 0))
  const totalTax = roundCurrency(lineTotals.reduce((sum, line) => sum + line.taxAmount, 0))
  const totalGross = roundCurrency(totalNet + totalTax)

  return {
    lineTotals,
    totalNet,
    totalTax,
    totalGross,
    totalDiscountAmount,
  }
}

export function buildLexofficeInvoicePayload(args: {
  customer: Customer
  invoiceForm: InvoiceFormState
  fallbackCountryCode?: string
}): CreateInvoicePayload {
  const { customer, invoiceForm, fallbackCountryCode = inferCountryCode(customer) } = args
  const voucherDate = toLexofficeDateTime(new Date(invoiceForm.voucherDate || new Date().toISOString().slice(0, 10)))

  const lineItems = invoiceForm.lines.map(line => (
    line.kind === 'text'
      ? {
          type: 'text' as const,
          name: line.name || undefined,
          description: line.description || undefined,
        }
      : {
          type: 'custom' as const,
          name: line.name,
          description: line.description || undefined,
          quantity: line.quantity,
          unitName: line.unitName,
          unitPrice: {
            currency: 'EUR' as const,
            netAmount: roundCurrency(line.unitPriceNet),
            taxRatePercentage: line.taxRate,
          },
          discountPercentage: roundCurrency(line.discountPercentage),
        }
  ))

  const shippingConditions = invoiceForm.serviceDateFrom && invoiceForm.serviceDateTo
    ? {
        shippingType: 'serviceperiod' as const,
        shippingDate: toLexofficeDateTime(new Date(invoiceForm.serviceDateFrom)),
        shippingEndDate: toLexofficeDateTime(new Date(invoiceForm.serviceDateTo)),
      }
    : invoiceForm.serviceDateFrom
      ? {
          shippingType: 'service' as const,
          shippingDate: toLexofficeDateTime(new Date(invoiceForm.serviceDateFrom)),
        }
      : { shippingType: 'none' as const }

  return {
    voucherDate,
    address: {
      contactId: customer.lexofficeContactId,
      name: invoiceForm.customerName,
      supplement: invoiceForm.addressSupplement || undefined,
      street: invoiceForm.street || undefined,
      zip: invoiceForm.zip || undefined,
      city: invoiceForm.city || undefined,
      countryCode: invoiceForm.countryCode || fallbackCountryCode,
    },
    lineItems,
    totalPrice: {
      currency: 'EUR',
      totalDiscountPercentage: invoiceForm.totalDiscountPercentage > 0
        ? roundCurrency(invoiceForm.totalDiscountPercentage)
        : undefined,
    },
    taxConditions: { taxType: 'net' },
    shippingConditions,
    paymentConditions: {
      paymentTermLabel: `Zahlbar innerhalb von ${invoiceForm.paymentTermDays} Tagen`,
      paymentTermDuration: invoiceForm.paymentTermDays,
    },
    title: invoiceForm.title || undefined,
    introduction: invoiceForm.introduction || undefined,
    remark: invoiceForm.remark || undefined,
  }
}

export function buildInvoiceLinesFromAllocation(args: {
  requestId?: string
  locationName: string
  checkIn: string
  checkOut: string
  allocations: AllocationEntry[]
}): InvoiceLineItem[] {
  const requestId = args.requestId ?? `req-${Date.now()}`
  return args.allocations.map((entry, index) => ({
    ...entry,
    requestId,
    positionNumber: index + 1,
    locationName: args.locationName,
    checkIn: args.checkIn,
    checkOut: args.checkOut,
  }))
}

export function buildSharedBookingNotes(args: {
  locationName: string
  checkIn: string
  checkOut: string
  bedsNeeded: number
  invoiceForm: InvoiceFormState
}) {
  const lines = [
    'Sammelbuchung',
    `Pos. 1: ${args.locationName}, ${formatRange(args.checkIn, args.checkOut)}, ${args.bedsNeeded} Betten`,
    args.invoiceForm.totalDiscountPercentage > 0 ? `Gesamtrabatt: ${args.invoiceForm.totalDiscountPercentage}%` : '',
    args.invoiceForm.remark.trim(),
  ]

  return lines.filter(Boolean).join('\n')
}

export function buildBookingInsertInputs(args: {
  customerId: string
  bookingStatus: BookingStatus
  invoiceLines: InvoiceLineItem[]
  invoiceForm: InvoiceFormState
  draftInvoice: DraftInvoiceState
  locationName: string
  bedsNeeded: number
  paymentStatus?: Booking['paymentStatus']
}): BookingInsertInput[] {
  const { customerId, bookingStatus, invoiceLines, invoiceForm, draftInvoice, locationName, bedsNeeded } = args
  const invoiceTotals = calculateInvoiceFormTotals(invoiceForm.lines, invoiceForm.totalDiscountPercentage)
  const bookingLineTotals = invoiceTotals.lineTotals.reduce((acc, line) => {
    if (!line.linkedBooking || !line.sourceKey) return acc
    acc[line.sourceKey] = roundCurrency((acc[line.sourceKey] ?? 0) + line.netAfterTotalDiscount + line.taxAmount)
    return acc
  }, {} as Record<string, number>)

  const firstLine = invoiceLines[0]
  const sharedNotes = buildSharedBookingNotes({
    locationName,
    checkIn: firstLine?.checkIn ?? new Date().toISOString().slice(0, 10),
    checkOut: firstLine?.checkOut ?? new Date().toISOString().slice(0, 10),
    bedsNeeded,
    invoiceForm,
  })

  return invoiceLines.map(line => {
    const finalPrice = bookingLineTotals[`${line.requestId}:${line.propertyId}`] ?? line.subtotal
    return {
      propertyId: line.propertyId,
      customerId,
      checkIn: line.checkIn,
      checkOut: line.checkOut,
      nights: line.nights,
      bedsBooked: line.bedsAllocated,
      pricePerBedNight: line.pricePerBedNight,
      cleaningFee: line.cleaningFee,
      totalPrice: finalPrice,
      status: bookingStatus,
      paymentStatus: args.paymentStatus ?? 'offen',
      notes: `${sharedNotes}\nRechnungsposition ${line.positionNumber}: ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}`,
      lexofficeInvoiceId: draftInvoice.id,
      invoiceNumber: draftInvoice.voucherNumber ?? '',
      source: 'manual' as const,
    }
  })
}

export function summarizeInvoiceTotals(invoiceForm: InvoiceFormState) {
  const totals = calculateInvoiceFormTotals(invoiceForm.lines, invoiceForm.totalDiscountPercentage)
  return `Netto ${totals.totalNet.toFixed(2)} EUR · Steuer ${totals.totalTax.toFixed(2)} EUR · Brutto ${totals.totalGross.toFixed(2)} EUR`
}

export function validateSingleRequestDates(checkIn: string, checkOut: string) {
  return differenceInDays(new Date(checkOut), new Date(checkIn)) > 0
}
