import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, test } from 'vitest'
import { ApplicationFactory } from '../../src'
import { expect } from '../expect'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://pro.alice.example/ccbd77ae-f769-4e07-b41f-5136501e13e7'

describe('build', () => {
  test.skip('should return a data instance POJO', async () => {
    const dataInstance = await factory.readable.dataInstance(snippetIri)
    expect(dataInstance.id).toBe(snippetIri)
  })
  test('should throw if unable to build data registration', async () => {
    await expect(factory.readable.dataInstance(snippetIri)).rejects.toThrow()
  })

  test.todo('should create data registration')

  test.todo('should get shape tree description if language provided')

  test.todo('should provide label')
})
