import { afterAll, beforeAll } from 'vitest'
import { dropAuth, seedAuth, seedRegistry } from './util'

beforeAll(async () => {
  await seedAuth()
  await seedRegistry()
})
