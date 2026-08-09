import { INTEROP } from '@janeirodigital/interop-utils'
import { describe, test } from 'vitest'
import { AccessDescription } from '../../src'
import { expect } from '../expect'
import { docFromGraphs } from './helpers'

const DESCRIPTIONS_GRAPH = 'https://data/test-client/public/descriptions-en'
const NEED_DESC_IRI = 'https://data/test-client/public/descriptions-en#en-need-project'
const GROUP_DESC_IRI = 'https://data/test-client/public/descriptions-en#en-need-group-pm'

// Graph <https://data/test-client/public/descriptions-en> in registry.trig:
// the English AccessDescriptionSet with need and need-group descriptions.
describe('AccessDescription framing', () => {
  test('frames an access need description into AccessNeedDescriptionData', async () => {
    const doc = await docFromGraphs([DESCRIPTIONS_GRAPH])
    const description = await AccessDescription.accessNeedDescriptionFromJsonLd(doc, NEED_DESC_IRI)
    expect(description).toEqual({
      id: NEED_DESC_IRI,
      type: [INTEROP.AccessNeedDescription.value],
      prefLabel:
        'Access to Projects is essential for Projectron to perform its core function of Project Management.',
      definition: undefined,
      hasAccessNeed: 'https://data/test-client/public/access-needs#need-project',
    })
  })

  test('frames an access need group description into AccessNeedGroupDescriptionData', async () => {
    const doc = await docFromGraphs([DESCRIPTIONS_GRAPH])
    const description = await AccessDescription.accessNeedGroupDescriptionFromJsonLd(
      doc,
      GROUP_DESC_IRI
    )
    expect(description).toEqual({
      id: GROUP_DESC_IRI,
      type: [INTEROP.AccessNeedGroupDescription.value],
      prefLabel: 'Manage Projects',
      definition: 'Allow Projectron to read the Projects you select, and Task in those projects.',
      hasAccessNeedGroup: 'https://data/test-client/public/access-needs#need-group-pm',
    })
  })
})
