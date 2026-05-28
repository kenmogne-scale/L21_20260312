import { NextRequest, NextResponse } from 'next/server'

import { createTelegramAvailabilityMessage } from '@/lib/availability-response'
import { parseAvailabilityMessage } from '@/lib/availability-message-parser'
import { checkAvailability, loadLocations } from '@/lib/availability-service'
import { answerCallbackQuery, escapeHtml, sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram'
import { handleTelegramWorkflowMessage } from '@/lib/telegram-workflow'

type TelegramWebhookBody = {
  message?: {
    message_id: number
    text?: string
    chat?: {
      id: number
    }
  }
  callback_query?: {
    id: string
    from: { id: number }
    message?: {
      chat: { id: number }
    }
    data?: string
  }
}

function mapCallbackToText(data: string): string | null {
  if (data === 'confirm_yes') return 'ja'
  if (data === 'confirm_no') return 'nein'
  if (data.startsWith('tax_')) return data.replace('tax_', '')
  if (data.startsWith('discount_')) return data.replace('discount_', '')
  if (data.startsWith('property_')) return data.replace('property_', '')
  if (data.startsWith('payterm_')) return data.replace('payterm_', '')
  if (data.startsWith('cleaning_')) return data.replace('cleaning_', '')
  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TelegramWebhookBody

    // ── Handle callback queries (inline keyboard button presses) ──
    if (body.callback_query) {
      const callbackQuery = body.callback_query
      const chatId = callbackQuery.message?.chat?.id
      const callbackData = callbackQuery.data

      // Acknowledge the callback immediately to remove the loading spinner
      await answerCallbackQuery(callbackQuery.id)

      if (!chatId || !callbackData) {
        return NextResponse.json({ ok: true, ignored: 'invalid-callback' })
      }

      const text = mapCallbackToText(callbackData)
      if (!text) {
        return NextResponse.json({ ok: true, ignored: 'unknown-callback' })
      }

      try {
        console.log('[Telegram] Callback:', JSON.stringify({ chatId, callbackData, mappedText: text }))
        const workflowResult = await handleTelegramWorkflowMessage(chatId, text)
        if (workflowResult.handled) {
          await sendTelegramMessage(chatId, workflowResult.reply, workflowResult.replyMarkup)
          if (workflowResult.document) {
            await sendTelegramDocument({
              chatId,
              fileName: workflowResult.document.fileName,
              contentType: workflowResult.document.contentType,
              data: workflowResult.document.data,
              caption: workflowResult.document.caption,
            })
          }
        }
        return NextResponse.json({ ok: true, callback: true })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
        console.error('Telegram callback error:', message, error instanceof Error ? error.stack : '')
        await sendTelegramMessage(chatId, `Es ist ein Fehler aufgetreten. Bitte versuche es erneut oder sende <code>/status</code>.`)
        return NextResponse.json({ ok: true, handledError: message })
      }
    }

    // ── Handle regular text messages ──
    const text = body.message?.text?.trim()
    const chatId = body.message?.chat?.id

    if (!chatId) {
      return NextResponse.json({ ok: true, ignored: 'missing-chat-id' })
    }

    if (!text) {
      await sendTelegramMessage(
        chatId,
        'Bitte sende eine Textnachricht wie: Ist von heute bis Donnerstag 5 Betten in Berlin frei?',
      )
      return NextResponse.json({ ok: true, ignored: 'missing-text' })
    }

    try {
      console.log('[Telegram] Incoming message:', JSON.stringify({ chatId, text }))
      const workflowResult = await handleTelegramWorkflowMessage(chatId, text)
      console.log('[Telegram] Workflow result:', JSON.stringify({ handled: workflowResult.handled, replyLength: workflowResult.reply?.length, hasDocument: !!workflowResult.document }))
      if (workflowResult.handled) {
        await sendTelegramMessage(chatId, workflowResult.reply, workflowResult.replyMarkup)
        if (workflowResult.document) {
          await sendTelegramDocument({
            chatId,
            fileName: workflowResult.document.fileName,
            contentType: workflowResult.document.contentType,
            data: workflowResult.document.data,
            caption: workflowResult.document.caption,
          })
        }
        return NextResponse.json({ ok: true, workflow: true })
      }

      const locations = await loadLocations()
      const parsedRequest = parseAvailabilityMessage(text, locations)
      const result = await checkAvailability(parsedRequest)
      const reply = createTelegramAvailabilityMessage(result, parsedRequest)

      await sendTelegramMessage(chatId, reply)

      return NextResponse.json({
        ok: true,
        request: parsedRequest,
        summary: reply,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
      const stack = error instanceof Error ? error.stack : ''
      console.error('Telegram webhook inner error:', message, stack)
      await sendTelegramMessage(
        chatId,
        `Es ist ein Fehler aufgetreten. Bitte versuche es erneut oder sende <code>/status</code>.`,
      )

      return NextResponse.json({ ok: true, handledError: message })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    console.error('Telegram webhook outer error:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
