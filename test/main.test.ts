import { describe, expect, test } from 'vitest'
import { seedRegistry } from './util.js'

describe('main', () => {
  test('auth', async () => {
    const reponse = await fetch('https://auth/.sai/agents/aHR0cHM6Ly9pZC9hbGljZQ')
    expect(reponse.ok).toBeTruthy()
  })
  test('registry', async () => {
    const seedResponse = await seedRegistry()
    const reponse = await fetch('https://registry/alice/agent/cvmsa4/')
    expect(reponse.ok).toBeTruthy()
  })
  test('data', async () => {
    const reponse = await fetch('https://data')
    expect(reponse.ok).toBeTruthy()
  })
  test('id', async () => {
    const reponse = await fetch('https://id/alice')
    expect(reponse.ok).toBeTruthy()
  })
})
