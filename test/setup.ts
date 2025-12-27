import { beforeEach } from 'vitest'
import { dropAuth, seedAuth, seedRegistry } from './util'

beforeEach(async () => {
  await seedAuth()
  await seedRegistry()
})
