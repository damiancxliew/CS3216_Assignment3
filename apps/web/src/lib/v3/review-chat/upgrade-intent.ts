/** Only explicit adventure-format requests open the reviewed upgrade workflow. */
export function requestsSchemaUpgrade(message: string): boolean {
  const text = message.trim().toLowerCase()
  if (/\b(?:do not|don't|never|how|what|why|should)\b/.test(text)) return false
  if (/^(?:upgrade|migrate)[.!]?$/.test(text)) return true
  return /\b(?:upgrade|migrate)\b.{0,45}\b(?:adventure|game|schema|format)\b/.test(text)
}
