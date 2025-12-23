import { describe, expect, test } from 'vitest'

describe('main', () => {
  test('auth', async () => {
    const response = await fetch('https://auth')
    expect(response.ok).toBeTruthy()
  })
  test('registry', async () => {
    const response = await fetch('https://registry')
    expect(response.ok).toBeTruthy()
  })
  test('data', async () => {
    const response = await fetch('https://data')
    expect(response.ok).toBeTruthy()
  })
  test('id', async () => {
    const response = await fetch('https://id/alice')
    expect(response.ok).toBeTruthy()
  })
})
