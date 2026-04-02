import { NextRequest, NextResponse } from 'next/server'

import { createContact, type CreateContactPayload } from '@/lib/lexoffice'

type Body = {
  customerId: string
  payload: CreateContactPayload
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Body

    if (!body.customerId) {
      return NextResponse.json({ ok: false, error: 'customerId fehlt.' }, { status: 400 })
    }

    const result = await createContact(body.payload)
    return NextResponse.json({ ok: true, id: result.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
