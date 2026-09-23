import { randomUUID } from 'node:crypto'
import { fetch } from '@janeirodigital/interop-test-utils'
import { loader } from '@janeirodigital/interop-utils'
import { test } from 'vitest'
import { AccessNeedDescription } from '../../src'
const loadAccessNeedDescription = loader(AccessNeedDescription.fromJsonLd)

import { expect } from '../expect'

const deps = { fetch, randomUUID }
const snippetIri = 'https://projectron.example/descriptions-en#en-need-project'

test('getters', async () => {
  const description = await loadAccessNeedDescription(snippetIri, deps.fetch)
  const expectedAccessNeedIri = 'https://projectron.example/access-needs#need-project'
  expect(description.hasAccessNeed).toBe(expectedAccessNeedIri)
  const expectedLabel =
    'Access to Projects is essential for Projectron to perform its core function of Project Management'
  expect(description.label).toEqual({ en: expectedLabel })
  expect(description.definition).toBe(undefined)
})
