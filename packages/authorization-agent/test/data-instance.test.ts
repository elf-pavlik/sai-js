import { randomUUID } from 'node:crypto'
import { loadDataInstance } from '@janeirodigital/interop-authorization-agent'
import { fetch } from '@janeirodigital/interop-test-utils'
import { describe, expect, test } from 'vitest'

const deps = { fetch, randomUUID }
const projectIri = 'https://pro.alice.example/7a130c38-668a-4775-821a-08b38f2306fb#project'
const projectShapeTree = 'https://solidshapes.example/trees/Project'
const taskShapeTree = 'https://solidshapes.example/trees/Task'

describe('build', () => {
  test('should return a data instance POJO', async () => {
    const dataInstance = await loadDataInstance(projectIri, deps.fetch, projectShapeTree)
    expect(dataInstance.id).toBe(projectIri)
    expect(dataInstance.shapeTreeIri).toBe(projectShapeTree)
    expect(dataInstance.isBlob).toBe(false)
    expect(dataInstance.children).toEqual([])
  })

  test('should throw if unable to build data registration', async () => {
    await expect(
      loadDataInstance('https://pro.alice.example/ccbd77ae-f769-4e07-b41f-5136501e13e7', deps.fetch)
    ).rejects.toThrow()
  })

  test('should provide label and children if language provided', async () => {
    const dataInstance = await loadDataInstance(projectIri, deps.fetch, projectShapeTree, 'en')
    // Project tree does not define describesInstance, so no label is derived
    expect(dataInstance.label).toBeUndefined()
    expect(dataInstance.children).toHaveLength(1)
    expect(dataInstance.children[0].shapeTree.id).toBe(taskShapeTree)
    expect(dataInstance.children[0].count).toBe(1)
  })
})
