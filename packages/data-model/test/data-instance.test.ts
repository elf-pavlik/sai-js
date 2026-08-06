import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { RDFS, getOneMatchingQuad } from '@janeirodigital/interop-utils'
import type { DatasetCore } from '@rdfjs/types'
import { DataFactory } from 'n3'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { ApplicationFactory, DataInstance } from '../src'

const factory = new ApplicationFactory({ fetch, randomUUID })
const snippetIri = 'https://pro.alice.example/7a130c38-668a-4775-821a-08b38f2306fb#project'
const defaultDataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
const taskShapeTree = 'https://solidshapes.example/trees/Task'
let defaultDataGrant: any

beforeAll(async () => {
  defaultDataGrant = await factory.readable.dataGrant(defaultDataGrantIri)
})

describe('build', () => {
  describe('rdf', () => {
    test('should fetch its data', async () => {
      const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
      expect(dataInstance.dataset.size).toBeGreaterThan(0)
    })
  })

  describe('blob', () => {
    test.todo('should fetch data from description resource')
  })
})

describe('getChildInstancesIterator', () => {
  test('should iterate over children data instances', async () => {
    const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
    const dataGrant = await factory.readable.dataGrant(dataGrantIri)
    const dataInstance = await DataInstance.build(snippetIri, dataGrant, factory)
    let count = 0
    const iterable = await dataInstance.getChildInstancesIterator(taskShapeTree)
    for await (const child of iterable) {
      expect(child).toBeInstanceOf(DataInstance)
      count += 1
    }
    expect(count).toBe(1)
  })
  test('should throw if called on child data instance', async () => {
    const dataInstanceIri = 'https://home.alice.example/f950bae5-247c-49b2-a537-b12cda8d5758#task'
    const inheritingDataGrantIri = 'https://auth.alice.example/54b1a123-23ca-4733-9371-700b52b9c567'
    const inheritingDataGrant = await factory.readable.dataGrant(inheritingDataGrantIri)
    const dataInstance = await DataInstance.build(dataInstanceIri, inheritingDataGrant, factory)
    await expect(dataInstance.getChildInstancesIterator(taskShapeTree)).rejects.toThrow(
      'can not have child instance'
    )
  })
})

describe('newChildDataInstance', () => {
  test('should provide newChildDataInstance method', async () => {
    const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
    const dataGrant = await factory.readable.dataGrant(dataGrantIri)
    const dataInstance = await DataInstance.build(snippetIri, dataGrant, factory)
    expect(await dataInstance.newChildDataInstance(taskShapeTree)).toBeInstanceOf(DataInstance)
  })

  test('should throw if called on child data instance', async () => {
    const dataInstanceIri = 'https://home.alice.example/f950bae5-247c-49b2-a537-b12cda8d5758#task'
    const inheritingDataGrantIri = 'https://auth.alice.example/54b1a123-23ca-4733-9371-700b52b9c567'
    const inheritingDataGrant = await factory.readable.dataGrant(inheritingDataGrantIri)
    const dataInstance = await DataInstance.build(dataInstanceIri, inheritingDataGrant, factory)
    await expect(dataInstance.newChildDataInstance(taskShapeTree)).rejects.toThrow(
      'can not have child instance'
    )
  })
})

test('should forward accessMode from the grant', async () => {
  const dataGrantIri = 'https://auth.alice.example/cd247a67-0879-4301-abd0-828f63abb252'
  const dataGrant = await factory.readable.dataGrant(dataGrantIri)
  const dataInstance = await DataInstance.build(snippetIri, dataGrant, factory)
  expect(dataInstance.accessMode).toEqual(dataGrant.accessMode)
})

describe('delete', () => {
  test('should properly use fetch', async () => {
    // @ts-ignore
    const localFactory = new ApplicationFactory({ fetch: vi.fn(fetch), randomUUID })
    const dataInstance = await localFactory.dataInstance(snippetIri, defaultDataGrant)
    await dataInstance.delete()
    expect(localFactory.fetch).toHaveBeenCalledWith(snippetIri, { method: 'DELETE' })
  })

  test('should throw if failed', async () => {
    const fakeFetch = () => Promise.resolve({ ok: false })
    const localFactory = new ApplicationFactory({ fetch, randomUUID })
    const dataInstance = await localFactory.dataInstance(snippetIri, defaultDataGrant)
    // @ts-ignore
    dataInstance.fetch = fakeFetch
    return expect(dataInstance.delete()).rejects.toThrow('failed')
  })

  test('should remove reference from parent if a child', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    let taskToDelete

    const iterable = await dataInstance.getChildInstancesIterator(taskShapeTree)
    for await (const task of iterable) {
      taskToDelete = task
      break
    }
    const spy = vi.spyOn(dataInstance, 'updateRemovingChildReference')
    await taskToDelete.delete()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('should not try to remove reference from parent if child is a draft', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    const taskToDelete = await dataInstance.newChildDataInstance(taskShapeTree)
    const spy = vi.spyOn(dataInstance, 'updateRemovingChildReference')
    await taskToDelete.delete()
    expect(spy).toHaveBeenCalledTimes(0)
  })
})

describe('update', () => {
  let otherProjectIri: string
  let differentDataset: DatasetCore
  beforeAll(async () => {
    otherProjectIri = 'https://pro.alice.example/ccbd77ae-f769-4e07-b41f-5136501e13e7#project'
    differentDataset = (await factory.dataInstance(otherProjectIri, defaultDataGrant)).dataset
  })

  test('should properly use fetch', async () => {
    // @ts-ignore
    const localFactory = new ApplicationFactory({ fetch: vi.fn(fetch), randomUUID })
    const dataInstance = await localFactory.dataInstance(snippetIri, defaultDataGrant)
    const dataRegistrationIri = 'https://pro.alice.example/773605f0-b5bf-4d46-878d-5c167eac8b5d'
    await dataInstance.update(differentDataset)
    expect(localFactory.fetch).toHaveBeenCalledWith(snippetIri, {
      method: 'PUT',
      dataset: differentDataset,
      headers: {
        Link: `<${dataRegistrationIri}>; rel="http://www.w3.org/ns/solid/interop#targetDataRegistration"`,
      },
    })
  })

  test('should set updated dataset on the data instance', async () => {
    // @ts-ignore
    const localFactory = new ApplicationFactory({ fetch: vi.fn(fetch), randomUUID })
    const dataInstance = await localFactory.dataInstance(snippetIri, defaultDataGrant)
    await dataInstance.update(differentDataset)
    expect(dataInstance.dataset).toBe(differentDataset)
  })

  test('should throw if failed', async () => {
    const fakeFetch = () => Promise.resolve({ ok: false })
    const localFactory = new ApplicationFactory({ fetch, randomUUID })
    const dataInstance = await localFactory.dataInstance(snippetIri, defaultDataGrant)
    // @ts-ignore
    dataInstance.fetch = fakeFetch
    return expect(dataInstance.update(differentDataset)).rejects.toThrow('failed')
  })

  test('should add reference to parent if a draft child', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    const taskToCreate = await dataInstance.newChildDataInstance(taskShapeTree)
    const spy = vi.spyOn(dataInstance, 'updateAddingChildReference')
    await taskToCreate.update(taskToCreate.dataset)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  describe('blob', () => {
    test.todo('draft should throw if no blob was provided')
    test.todo('should upload file')
    test.todo('should update description resource')
  })
})

test('updateAddingChildReference', async () => {
  const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
  const taskToCreate = await dataInstance.newChildDataInstance(taskShapeTree)
  const quad = DataFactory.quad(
    DataFactory.namedNode(dataInstance.iri),
    DataFactory.namedNode('https://vocab.example/project-management/hasTask'),
    DataFactory.namedNode(taskToCreate.iri),
    [...dataInstance.dataset][0].graph
  )
  expect(dataInstance.dataset.has(quad)).toBeFalsy()
  await dataInstance.updateAddingChildReference(taskToCreate)
  expect(dataInstance.dataset.has(quad)).toBeTruthy()
})

test('updateRemovingChildReference', async () => {
  const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
  let taskToDelete

  const iterable = await dataInstance.getChildInstancesIterator(taskShapeTree)
  for await (const task of iterable) {
    taskToDelete = task
    break
  }
  const quad = DataFactory.quad(
    DataFactory.namedNode(dataInstance.iri),
    DataFactory.namedNode('https://vocab.example/project-management/hasTask'),
    DataFactory.namedNode(taskToDelete.iri),
    [...dataInstance.dataset][0].graph
  )
  expect(dataInstance.dataset.has(quad)).toBeTruthy()
  await dataInstance.updateRemovingChildReference(taskToDelete)
  expect(dataInstance.dataset.has(quad)).toBeFalsy()
})

describe('replaceValue', () => {
  test('replace existing value', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    expect(getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.label)?.object.value).toBe('P-Ap-2')
    dataInstance.replaceValue(RDFS.label, 'New label')
    expect(getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.label)?.object.value).toBe('New label')
  })
  test('replace non-existing value', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    expect(getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.fake)?.object.value).toBeUndefined()
    dataInstance.replaceValue(RDFS.fake, 'something')
    expect(getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.fake)?.object.value).toBe('something')
  })
})

describe('addNode', () => {
  test('adds triple to dataset', async () => {
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    expect(getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.fake)?.object.value).toBeUndefined()
    dataInstance.addNode(RDFS.fake.value, 'https://iri.example')
    const node = getOneMatchingQuad(dataInstance.dataset, dataInstance.node, RDFS.fake)!.object
    expect(node.value).toBe('https://iri.example')
    expect(node.termType).toBe('NamedNode')
  })
})

describe('fetchBlob', () => {
  test('', async () => {
    const mockedResponse = { blob: vi.fn() }
    const originalRaw = factory.fetch.raw
    // @ts-ignore
    factory.fetch.raw = vi.fn(async (iri: string, options?: RequestInit) => {
      if (options) {
        // delegate requests with options (e.g. shape tree JSON-LD fetch during bootstrap)
        return originalRaw(iri, options)
      }
      return mockedResponse
    })
    const dataInstance = await DataInstance.build(snippetIri, defaultDataGrant, factory)
    await dataInstance.fetchBlob()
    // @ts-ignore
    expect(factory.fetch.raw).toHaveBeenCalledWith(snippetIri)
    expect(mockedResponse.blob).toHaveBeenCalledTimes(1)
  })
})
