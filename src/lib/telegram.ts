import 'server-only'

const telegramToken = process.env.TELEGRAM_BOT_TOKEN

function getTelegramApiUrl(method: string) {
  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN fehlt.')
  }

  return `https://api.telegram.org/bot${telegramToken}/${method}`
}

export async function sendTelegramMessage(chatId: number | string, text: string) {
  const normalizedText = String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 4000)

  const response = await fetch(getTelegramApiUrl('sendMessage'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: normalizedText,
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram sendMessage fehlgeschlagen: ${response.status} ${body}`)
  }

  return response.json()
}
