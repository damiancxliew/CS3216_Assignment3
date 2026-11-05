import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { Agent, fetch as undiciFetch } from 'undici'

import { isPrivateAddress } from './private-address'

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

type PublicLookup = (
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
) => void

export function publicOnlyLookup(
  resolve = (hostname: string) => dnsLookup(hostname, { all: true }),
): PublicLookup {
  return (hostname, options, callback) => {
    void Promise.resolve()
      .then(() => resolve(hostname))
      .then((addresses) => {
        if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
          const error = Object.assign(new Error('DNS lookup returned no public addresses'), {
            code: 'ERR_SOURCE_PRIVATE_ADDRESS',
          })
          callback(error, '')
          return
        }

        if (options.all) {
          callback(null, addresses)
          return
        }

        const first = addresses[0]!
        callback(null, first.address, first.family)
      })
      .catch((cause: unknown) => {
        callback(cause instanceof Error ? cause : new Error(String(cause)), '')
      })
  }
}

const agent = new Agent({ connect: { lookup: publicOnlyLookup() } })
const fetchWithAgent = undiciFetch as unknown as (
  input: Parameters<typeof fetch>[0],
  init?: Omit<RequestInit, 'dispatcher'> & { dispatcher: unknown },
) => Promise<Response>

export const pinnedFetch: typeof fetch = (input, init) =>
  fetchWithAgent(input, { ...init, dispatcher: agent })
