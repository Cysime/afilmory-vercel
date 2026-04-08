import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { S3StorageProvider } from '../storage/providers/s3-provider.js'

describe('S3StorageProvider.getFile', () => {
  const config = {
    provider: 's3' as const,
    bucket: 'bucket',
    region: 'auto',
    endpoint: 'https://example.com',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('clears the total timeout when the response body is already a Buffer', async () => {
    const provider = new S3StorageProvider(config)
    const send = vi.fn().mockResolvedValue({
      Body: Buffer.from('hello'),
      ContentLength: 5,
    })
    ;(provider as unknown as { s3Client: { send: typeof send } }).s3Client = { send }

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    await expect(provider.getFile('image.jpg')).resolves.toEqual(Buffer.from('hello'))
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  it('clears the total timeout when the response body is missing', async () => {
    const provider = new S3StorageProvider(config)
    const send = vi.fn().mockResolvedValue({})
    ;(provider as unknown as { s3Client: { send: typeof send } }).s3Client = { send }

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    await expect(provider.getFile('image.jpg')).resolves.toBeNull()
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
