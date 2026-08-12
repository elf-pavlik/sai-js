import { SHAPETREES, toStore } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { ShapeTree } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const TREE_IRI = 'https://data/shapetrees/trees/Project'
const TREE_GRAPH = 'https://data/shapetrees/trees/Project'

// Graph <https://data/shapetrees/trees/Project> in registry.trig:
// ShapeTree with expectsType, shape, describesInstance (rdfs:label), three
// references (hasShapeTree/viaPredicate blank nodes) and the description sets
// carrying usesLanguage. The read path is quad-based (fromDataset), not
// framing; the toJsonLd round-trip below exercises the shape tree context.
describe('ShapeTree framing', () => {
  test('converts the shape tree graph into ShapeTreeData', async () => {
    const doc = await docFromGraphs([TREE_GRAPH])
    const tree = await ShapeTree.fromJsonLd(doc, TREE_IRI)
    expect({
      ...tree,
      // viaPredicate is a NamedNode in ShapeTreeData (quad-based read path)
      references: tree.references.map((reference) => ({
        shapeTree: reference.shapeTree,
        viaPredicate: reference.viaPredicate.value,
      })),
    }).toEqual({
      id: TREE_IRI,
      type: [SHAPETREES.ShapeTree],
      shape: 'https://data/shapetrees/shapes/Project',
      describesInstance: 'http://www.w3.org/2000/01/rdf-schema#label',
      expectsType: SHAPETREES.Resource,
      descriptionLanguages: ['en', 'es', 'pl'],
      references: [
        {
          shapeTree: 'https://data/shapetrees/trees/Task',
          viaPredicate: 'https://vocab.example/project-management/hasTask',
        },
        {
          shapeTree: 'https://data/shapetrees/trees/Image',
          viaPredicate: 'https://vocab.example/project-management/hasImage',
        },
        {
          shapeTree: 'https://data/shapetrees/trees/File',
          viaPredicate: 'https://vocab.example/project-management/hasFile',
        },
      ],
    })
  })

  test('toJsonLd round-trips through the dataset', async () => {
    const doc = await docFromGraphs([TREE_GRAPH])
    const tree = await ShapeTree.fromJsonLd(doc, TREE_IRI)
    const store = await toStore(ShapeTree.toJsonLd(tree), TREE_IRI)
    const roundTripped = await ShapeTree.fromDataset(store, TREE_IRI)
    expect(roundTripped.shape).toBe(tree.shape)
    expect(roundTripped.type).toEqual(tree.type)
    expect(roundTripped.describesInstance).toBe(tree.describesInstance)
    expect(roundTripped.expectsType).toBe(tree.expectsType)
    expect(roundTripped.descriptionLanguages).toEqual(tree.descriptionLanguages)
    expect(
      roundTripped.references.map((reference) => [
        reference.shapeTree,
        reference.viaPredicate.value,
      ])
    ).toEqual(
      tree.references.map((reference) => [reference.shapeTree, reference.viaPredicate.value])
    )
  })
})
