import { isIP } from 'node:net'

export const DEFAULT_ALLOWED_DOMAINS = [
  'nas.gov.sg',
  'nlb.gov.sg',
  'eresources.nlb.gov.sg',
  'roots.gov.sg',
  'nhb.gov.sg',
  'nationalarchives.gov.uk',
  'bl.uk',
  'archives.gov',
  'loc.gov',
  'britannica.com',
  'wikipedia.org',
  'wikisource.org',
  'nus.edu.sg',
  'ntu.edu.sg',
  'smu.edu.sg',
  'si.edu',
  'britishmuseum.org',
  'un.org',
] as const

export interface SourcePolicy {
  extraDomains?: string[]
  allowAny?: boolean
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.localdomain')
    || hostname.endsWith('.internal')
}

export function normaliseDomain(input: string): string | null {
  const value = input.trim()
  if (!value) return null

  let hostname: string
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
      const url = new URL(value)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.port) {
        return null
      }
      hostname = url.hostname
    } else {
      hostname = (value.split(/[/?#]/, 1)[0] ?? '').toLowerCase()
      if (hostname.includes(':')) return null
    }
  } catch {
    return null
  }

  hostname = hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.startsWith('www.')) hostname = hostname.slice(4)
  if (
    hostname.length > 253 ||
    !hostname.includes('.') ||
    isIP(hostname) !== 0 ||
    isLocalHostname(hostname)
  ) {
    return null
  }

  const labels = hostname.split('.')
  if (labels.some((label) =>
    label.length === 0 ||
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  )) {
    return null
  }
  return hostname
}

export function allowedDomains(policy: SourcePolicy = {}): string[] | null {
  if (policy.allowAny) return null

  const domains: string[] = [...DEFAULT_ALLOWED_DOMAINS]
  for (const input of policy.extraDomains ?? []) {
    const domain = normaliseDomain(input)
    if (domain) domains.push(domain)
  }
  return [...new Set(domains.map((domain) => domain.toLowerCase()))]
}

export function isAllowedUrl(url: string, policy: SourcePolicy = {}): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.port !== ''
  ) {
    return false
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(hostname) !== 0 || !hostname.includes('.') || isLocalHostname(hostname)) return false

  const domains = allowedDomains(policy)
  return domains === null || domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}
