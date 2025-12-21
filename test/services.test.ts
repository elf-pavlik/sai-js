import { describe, expect, test } from 'vitest'
import { seedRegistry } from './util.js'

describe('main', () => {
  test('auth', async () => {
    const response = await fetch('https://auth/.sai/agents/aHR0cHM6Ly9pZC9hbGljZQ')
    expect(response.ok).toBeTruthy()
  })
  test('registry', async () => {
    const seedResponse = await seedRegistry()
    const response = await fetch('https://registry/alice/agent/cvmsa4/')
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
