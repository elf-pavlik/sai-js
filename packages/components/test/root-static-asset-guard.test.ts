import { NotImplementedHttpError } from '@solid/community-server'
import { describe, expect, test, vi } from 'vitest'

import { RootStaticAssetGuard } from '../src/RootStaticAssetGuard.js'

const BASE_URL = 'https://data.docker/'

function innerHandler(): { canHandle: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn> } {
  return {
    canHandle: vi.fn(async () => {}),
    handle: vi.fn(async () => {}),
  }
}

function request(host: string, url = '/', headers: Record<string, string> = {}): unknown {
  return { request: { url, headers: { host, ...headers } } }
}

function guardFor() {
  const inner = innerHandler()
  return { guard: new RootStaticAssetGuard(inner as never, BASE_URL), inner }
}

describe('RootStaticAssetGuard', () => {
  test('refuses the root static asset on a pod subdomain', async () => {
    const { guard, inner } = guardFor()

    await expect(
      guard.canHandle(request('alice-home.data.docker') as never)
    ).rejects.toBeInstanceOf(NotImplementedHttpError)
    expect(inner.canHandle).not.toHaveBeenCalled()
  })

  test('serves the root static asset on the base host', async () => {
    const { guard, inner } = guardFor()

    await guard.canHandle(request('data.docker') as never)

    expect(inner.canHandle).toHaveBeenCalledOnce()
  })

  test('serves a subdomain request that is not the root', async () => {
    const { guard, inner } = guardFor()

    await guard.canHandle(request('alice-home.data.docker', '/public/') as never)

    expect(inner.canHandle).toHaveBeenCalledOnce()
  })

  test('ignores a port on the request host', async () => {
    const { guard } = guardFor()

    await expect(
      guard.canHandle(request('alice-home.data.docker:443') as never)
    ).rejects.toBeInstanceOf(NotImplementedHttpError)
  })

  test('ignores host casing and a trailing root dot', async () => {
    const { guard } = guardFor()

    await expect(
      guard.canHandle(request('ALICE-HOME.Data.Docker.') as never)
    ).rejects.toBeInstanceOf(NotImplementedHttpError)
  })

  test('uses the forwarded host when a proxy set one', async () => {
    const { guard } = guardFor()

    await expect(
      guard.canHandle(
        request('data:4700', '/', { 'x-forwarded-host': 'alice-home.data.docker' }) as never
      )
    ).rejects.toBeInstanceOf(NotImplementedHttpError)
  })

  test('keeps serving the root when the host does not resolve to a subdomain', async () => {
    const { guard, inner } = guardFor()

    await guard.canHandle(request('data:4700') as never)

    expect(inner.canHandle).toHaveBeenCalledOnce()
  })

  test('delegates handling to the wrapped handler', async () => {
    const { guard, inner } = guardFor()

    await guard.handle(request('data.docker') as never)

    expect(inner.handle).toHaveBeenCalledOnce()
  })
})
