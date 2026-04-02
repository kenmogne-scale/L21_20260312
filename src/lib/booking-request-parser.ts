import type { Customer, Location, Property } from '@/lib/types'

export type ParsedBookingRequest = {
  originalText: string
  checkIn?: string
  checkOut?: string
  bedsNeeded?: number
  requestedRooms?: number
  requestedNetPrice?: number
  requestedDiscountPercentage?: number
  requestedCleaningFee?: number
  requestedTaxRate?: 0 | 7 | 19
  requestedPaymentTermDays?: number
  contactName?: string
  email?: string
  phone?: string
  customerName?: string
  billingAddress?: string
  billingCompanyName?: string
  billingAddressSupplement?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
  billingCountry?: string
  billingTaxId?: string
  project?: string
  reference?: string
  matchedLocationId?: string
  matchedLocationName?: string
  matchedCustomerId?: string
  matchedCustomerName?: string
  matchedProperties: Property[]
  objectHint?: string
  clarificationQuestions: string[]
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeLoose(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCompact(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, '')
}

function toIsoDate(day: string, month: string, year: string) {
  const fullYear = year.length === 2 ? `20${year}` : year
  return `${fullYear.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function extractDateRange(text: string) {
  const patterns = [
    /von\s+(?:dem\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+bis\s+(?:zum\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i,
    /vom\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+bis\s+(?:zum\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    return {
      checkIn: toIsoDate(match[1], match[2], match[3]),
      checkOut: toIsoDate(match[4], match[5], match[6]),
    }
  }

  return {}
}

function extractFirstMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern)
  return match?.[1]?.trim()
}

function extractRequestedNetPrice(text: string) {
  const patterns = [
    /(?:zimmerpreis|bettenpreis|bettpreis|ez-preis|einzelzimmerpreis)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)?/i,
    /preis\s*(?:bitte)?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)?\s*(?:netto)?\s*(?:(?:pro|je)\s*(?:ez|einzelzimmer|zimmer|bett))?/i,
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur)\s*(?:netto)?\s*(?:(?:pro|je)\s*(?:ez|einzelzimmer|zimmer|bett))?/i,
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur)?\s*(?:netto\s*)?(?:pro|je)\s*(?:ez|einzelzimmer|zimmer|bett)(?:\/nacht|\s+pro\s+nacht)?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const amount = Number(match[1].replace(',', '.'))
    if (Number.isFinite(amount)) return amount
  }

  return undefined
}

function extractRequestedDiscountPercentage(text: string) {
  const match = text.match(/rabatt\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i)
  if (!match?.[1]) return undefined
  const amount = Number(match[1].replace(',', '.'))
  return Number.isFinite(amount) ? amount : undefined
}

function extractRequestedCleaningFee(text: string) {
  const patterns = [
    /(?:endreinigung|reinigung(?:sgebuhr|sgebühr)?|reinigungskosten)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)?/i,
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur)\s*(?:f(?:u|ü)r\s+)?(?:endreinigung|reinigung)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const amount = Number(match[1].replace(',', '.'))
    if (Number.isFinite(amount)) return amount
  }

  return undefined
}

function extractRequestedTaxRate(text: string): 0 | 7 | 19 | undefined {
  const match = text.match(/(?:mwst|ust|steuer(?:satz)?)\s*:?\s*(0|7|19)\s*%/i)
  if (!match?.[1]) return undefined
  const amount = Number(match[1])
  return amount === 0 || amount === 7 || amount === 19 ? amount : undefined
}

function extractRequestedPaymentTermDays(text: string) {
  const match = text.match(/(?:zahlungsziel|netto)\s*:?\s*(\d{1,3})\s*tage?/i)
  if (!match?.[1]) return undefined
  const amount = Number(match[1])
  return Number.isFinite(amount) ? amount : undefined
}

function findBillingBlock(text: string) {
  const match = text.match(/billing address\s*:?\s*([\s\S]+)/i)
  if (!match) return undefined

  const lines = match[1]
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return undefined
  return lines.join('\n')
}

function parseBillingAddressBlock(billingAddress?: string) {
  if (!billingAddress) {
    return {}
  }

  const lines = billingAddress
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return {}
  }

  let companyName = lines[0]
  let addressSupplement = ''
  let street = ''
  let zip = ''
  let city = ''
  let country = ''
  let taxId = ''

  for (const line of lines.slice(1)) {
    if (!taxId && /^org\.?\s*nr\b/i.test(line)) {
      taxId = line.replace(/^org\.?\s*nr\s*:?\s*/i, '').trim()
      continue
    }

    if (!street && /\d/.test(line) && !/^\d{4,5}\s+/.test(line)) {
      street = line
      continue
    }

    const zipCityMatch = line.match(/^(\d{4,5})\s+(.+)$/)
    if (zipCityMatch) {
      zip = zipCityMatch[1].trim()
      city = zipCityMatch[2].trim()
      continue
    }

    if (!country && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.-]+$/.test(line)) {
      country = line
      continue
    }

    if (!addressSupplement) {
      addressSupplement = line
    }
  }

  return {
    billingCompanyName: companyName || undefined,
    billingAddressSupplement: addressSupplement || undefined,
    billingStreet: street || undefined,
    billingZip: zip || undefined,
    billingCity: city || undefined,
    billingCountry: country || undefined,
    billingTaxId: taxId || undefined,
  }
}

function extractCustomerName(text: string, billingAddress?: string) {
  if (billingAddress) {
    const firstLine = billingAddress.split('\n')[0]?.trim()
    if (firstLine) return firstLine
  }

  const mailFromCustomer = text.match(/mail vom kunden\s*:?\s*([^\r\n]+)/i)
  if (mailFromCustomer) {
    return mailFromCustomer[1].trim()
  }

  return undefined
}

function scoreCustomer(customer: Customer, parserCustomerName?: string, email?: string) {
  let score = 0

  if (email) {
    const customerEmail = customer.email?.trim().toLocaleLowerCase()
    const normalizedEmail = email.trim().toLocaleLowerCase()
    if (customerEmail && customerEmail === normalizedEmail) {
      score += 1000
    } else if (customerEmail && normalizedEmail.includes(customerEmail)) {
      score += 700
    }
  }

  if (parserCustomerName) {
    const wanted = normalizeLoose(parserCustomerName)
    const company = normalizeLoose(customer.companyName)
    if (wanted && company) {
      if (wanted === company) score += 900
      else if (company.includes(wanted) || wanted.includes(company)) score += 550
    }
  }

  return score
}

function buildPropertyTerms(property: Property, location?: Location) {
  return [
    property.shortCode,
    property.name,
    ...property.aliases,
    location?.name ?? '',
    location?.city ?? '',
  ]
    .map(term => term.trim())
    .filter(Boolean)
}

function scoreProperty(property: Property, normalizedLooseText: string, normalizedCompactText: string, location?: Location) {
  let score = 0

  for (const term of buildPropertyTerms(property, location)) {
    const looseTerm = normalizeLoose(term)
    const compactTerm = normalizeCompact(term)
    if (!looseTerm && !compactTerm) continue

    if (compactTerm && normalizedCompactText.includes(compactTerm)) {
      score = Math.max(score, compactTerm.length >= 5 ? 900 + compactTerm.length : 600 + compactTerm.length)
    } else if (looseTerm && normalizedLooseText.includes(looseTerm)) {
      score = Math.max(score, 700 + looseTerm.length)
    }

    const shortCodePrefix = normalizeCompact(property.shortCode).match(/^[a-z]+\d+/)
    if (shortCodePrefix && normalizedCompactText.includes(shortCodePrefix[0])) {
      score = Math.max(score, 650 + shortCodePrefix[0].length)
    }
  }

  return score
}

export function parseBookingRequest(
  text: string,
  args: {
    properties: Property[]
    locations: Location[]
    customers: Customer[]
  },
): ParsedBookingRequest {
  const { properties, locations, customers } = args
  const trimmed = text.trim()
  const normalizedLooseText = normalizeLoose(trimmed)
  const normalizedCompactText = normalizeCompact(trimmed)
  const { checkIn, checkOut } = extractDateRange(trimmed)

  const contactName = extractFirstMatch(trimmed, /ansprechpartner\s*:?\s*([^\r\n]+)/i)
  const email = extractFirstMatch(trimmed, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
  const phone = extractFirstMatch(trimmed, /(\+?\d[\d\s()/.-]{6,}\d)/)
  const billingAddress = findBillingBlock(trimmed)
  const parsedBilling = parseBillingAddressBlock(billingAddress)
  const customerName = extractCustomerName(trimmed, billingAddress)
  const project = extractFirstMatch(trimmed, /project\s*:?\s*([^\r\n]+)/i)
  const reference = extractFirstMatch(trimmed, /reference\s*:?\s*([^\r\n]+)/i)
  const objectHint = extractFirstMatch(trimmed, /(hch\d+(?:\s*we\s*\d+)*)/i)?.toUpperCase()

  const personsMatch = trimmed.match(/(\d+)\s*personen?/i)
  const roomMatch = trimmed.match(/(\d+)\s*[- ]?\s*zimmer/i)
  const bedsNeeded = personsMatch ? Number(personsMatch[1]) : undefined
  const requestedRooms = roomMatch ? Number(roomMatch[1]) : undefined
  const parsedRequestedNetPrice = extractRequestedNetPrice(trimmed)
  const requestedDiscountPercentage = extractRequestedDiscountPercentage(trimmed)
  const requestedCleaningFee = extractRequestedCleaningFee(trimmed)
  const requestedTaxRate = extractRequestedTaxRate(trimmed)
  const requestedPaymentTermDays = extractRequestedPaymentTermDays(trimmed)

  const priceMatch =
    trimmed.match(/(\d+(?:[.,]\d+)?)\s*€?\s*netto/i) ??
    trimmed.match(/preis\s*(?:bitte)?\s*(\d+(?:[.,]\d+)?)\s*€?/i)
  const requestedNetPrice = priceMatch ? Number(priceMatch[1].replace(',', '.')) : undefined

  const rankedCustomers = customers
    .map(customer => ({
      customer,
      score: scoreCustomer(customer, customerName, email),
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  const bestCustomer = rankedCustomers[0]
  const matchedCustomer =
    bestCustomer && (bestCustomer.score >= 900 || bestCustomer.score - (rankedCustomers[1]?.score ?? 0) >= 150)
      ? bestCustomer.customer
      : undefined

  const rankedProperties = properties
    .map(property => ({
      property,
      score: scoreProperty(
        property,
        normalizedLooseText,
        normalizedCompactText,
        locations.find(location => location.id === property.locationId),
      ),
    }))
    .filter(entry => entry.score >= 650)
    .sort((a, b) => b.score - a.score)

  const bestPropertyScore = rankedProperties[0]?.score ?? 0
  const matchedProperties = rankedProperties
    .filter(entry => entry.score >= Math.max(650, bestPropertyScore - 80))
    .map(entry => entry.property)

  let matchedLocationId: string | undefined
  let matchedLocationName: string | undefined

  const uniqueLocationIds = Array.from(new Set(matchedProperties.map(property => property.locationId)))
  if (uniqueLocationIds.length === 1) {
    matchedLocationId = uniqueLocationIds[0]
    matchedLocationName = locations.find(location => location.id === matchedLocationId)?.name
  } else {
    const locationMatch = locations.find(location => {
      const looseName = normalizeLoose(location.name)
      const looseCity = normalizeLoose(location.city)
      return (
        (looseName && normalizedLooseText.includes(looseName)) ||
        (looseCity && normalizedLooseText.includes(looseCity))
      )
    })

    matchedLocationId = locationMatch?.id
    matchedLocationName = locationMatch?.name
  }

  const clarificationQuestions: string[] = []
  if (!matchedLocationId) clarificationQuestions.push('Welches Objekt bzw. welcher Standort soll verwendet werden?')
  if (!checkIn || !checkOut) clarificationQuestions.push('Welcher genaue Zeitraum soll gebucht werden?')
  if (!bedsNeeded) clarificationQuestions.push('Für wie viele Personen bzw. Betten soll gebucht werden?')
  if (matchedProperties.length > 1) clarificationQuestions.push('Mehrere passende Wohnungen gefunden. Welche Einheit soll genommen werden?')
  if (!matchedCustomer && !customerName && !email) clarificationQuestions.push('Welcher Auftraggeber soll für Rechnung und Buchung verwendet werden?')

  return {
    originalText: trimmed,
    checkIn,
    checkOut,
    bedsNeeded,
    requestedRooms,
    requestedNetPrice: parsedRequestedNetPrice ?? requestedNetPrice,
    requestedDiscountPercentage,
    requestedCleaningFee,
    requestedTaxRate,
    requestedPaymentTermDays,
    contactName,
    email,
    phone,
    customerName,
    billingAddress,
    ...parsedBilling,
    project,
    reference,
    matchedLocationId,
    matchedLocationName,
    matchedCustomerId: matchedCustomer?.id,
    matchedCustomerName: matchedCustomer?.companyName,
    matchedProperties,
    objectHint,
    clarificationQuestions,
  }
}
