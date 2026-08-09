import { ACL, INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AccessNeed } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const NEED_IRI = 'https://data/test-client/public/access-needs#need-project'
const ACCESS_NEEDS_GRAPH = 'https://data/test-client/public/access-needs'

// Graph <https://data/test-client/public/access-needs> in registry.trig:
// need-project (AccessRequired), with need-task/image/file inheriting from it
// (frames to hasInheritingNeed via @reverse), and the description sets
// carrying usesLanguage (collected into descriptionLanguages).
describe('AccessNeed framing', () => {
  test('frames the access needs graph into AccessNeedData', async () => {
    const doc = await docFromGraphs([ACCESS_NEEDS_GRAPH])
    const need = await AccessNeed.fromJsonLd(doc, NEED_IRI)
    expect(need).toEqual({
      id: NEED_IRI,
      type: [INTEROP.AccessNeed],
      registeredShapeTree: 'https://data/shapetrees/trees/Project',
      inheritsFromNeed: undefined,
      // reverse values are collected by iterating fromRDF's node list, which
      // is sorted by @id — deterministic: file < image < task
      hasInheritingNeed: [
        'https://data/test-client/public/access-needs#need-file',
        'https://data/test-client/public/access-needs#need-image',
        'https://data/test-client/public/access-needs#need-task',
      ],
      accessMode: [ACL.Read, ACL.Create, ACL.Update, ACL.Delete],
      required: true,
      children: [],
      descriptionLanguages: ['en', 'es'],
    })
  })
})
