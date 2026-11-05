import { isIP } from 'node:net'

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true
  }

  const [first, second] = octets
  if (first === undefined || second === undefined) return true
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
}

function ipv6Bytes(address: string): number[] | null {
  let value = address.toLowerCase().split('%', 1)[0] ?? ''
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const ipv4 = value.slice(lastColon + 1)
    if (lastColon < 0 || !isPrivateIpv4Format(ipv4)) return null
    const octets = ipv4.split('.').map(Number)
    const firstWord = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    const secondWord = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    value = `${value.slice(0, lastColon + 1)}${firstWord.toString(16)}:${secondWord.toString(16)}`
  }

  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = (halves[0] ?? '').split(':').filter(Boolean)
  const right = halves.length === 2 ? (halves[1] ?? '').split(':').filter(Boolean) : []
  const zeroCount = 8 - left.length - right.length
  if ((halves.length === 1 && zeroCount !== 0) || (halves.length === 2 && zeroCount < 1)) return null
  const parts = [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const words = parts.map((part) => Number.parseInt(part, 16))
  return words.flatMap((word) => [word >>> 8, word & 0xff])
}

function isPrivateIpv4Format(address: string): boolean {
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every((octet) =>
    Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family !== 6) return true

  const bytes = ipv6Bytes(address)
  if (!bytes) return true
  const allZero = bytes.every((byte) => byte === 0)
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  if (ipv4Mapped) return isPrivateIpv4(bytes.slice(12).join('.'))

  if (allZero || (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)) return true
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true

  const first = bytes[0] ?? 0
  const second = bytes[1] ?? 0
  return (first & 0xfe) === 0xfc ||
    (first === 0xfe && (second & 0xc0) === 0x80) ||
    first === 0xff
}
