import { describe, expect, test } from 'vitest'

describe('main', () => {
  test('auth', async () => {
    const reponse = await fetch('https://auth')
    expect(reponse.ok).toBeTruthy()
  })
  test('registry', async () => {
    const reponse = await fetch('https://registry')
    expect(reponse.ok).toBeTruthy()
  })
  test('data', async () => {
    const reponse = await fetch('https://data')
    expect(reponse.ok).toBeTruthy()
  })
})
