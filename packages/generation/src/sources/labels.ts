export function sourceLabel(input: {
  origin: 'teacher' | 'outside' | 'invented'
  title?: string
  masthead?: string
  date?: string
}): string {
  const title = input.title?.trim() ?? ''
  const masthead = input.masthead?.trim() ?? ''
  const date = input.date?.trim() ?? ''

  if (masthead && date) return `${masthead}, ${date}`
  if (title) return title
  if (input.origin === 'teacher') return 'from the teacher'
  if (input.origin === 'outside') return 'from an outside source'
  return 'invented'
}

/** User-facing import outcomes; acceptance is separate from whether a source is cited. */
export function sourceFailureLabel(reason: string): string {
  const labels: Record<string, string> = {
    empty_response: 'The site returned an empty response, including after retry.',
    too_short: 'The response did not contain enough readable source text.',
    not_allowlisted: 'The URL or a redirect is outside the selected source policy.',
    invalid_url: 'Search returned an invalid source URL.',
    private_address: 'The URL did not resolve to a permitted public address.',
    dns_lookup_failed: 'The source hostname could not be resolved.',
    timeout: 'The source did not respond within the time limit.',
    fetch_failed: 'The source could not be downloaded.',
    unsupported_content_type: 'This response is not HTML, plain text or PDF.',
    too_large: 'The download exceeds the permitted document size.',
    'too-large': 'The PDF exceeds the permitted document size.',
    'too-many-pages': 'The PDF has too many pages.',
    'too-long': 'The extracted document exceeds the text limit.',
    'no-text-layer': 'The PDF has no usable text layer. It may be scanned.',
    'unreadable-pdf': 'The PDF could not be parsed.',
    extract_failed: 'The document could not be extracted.',
  }
  if (reason === 'http_403') return 'The site denied access (HTTP 403).'
  if (reason === 'http_404') return 'The page is unavailable (HTTP 404).'
  if (/^http_\d+$/.test(reason)) return `The site returned HTTP ${reason.slice(5)}.`
  return labels[reason] ?? 'The source could not be imported.'
}
