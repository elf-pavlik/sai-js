import { describe, expect, test } from 'vitest'

import {
  SHARED_DATASET,
  datasetForGraph,
  datasetForPod,
  fixturePodDatasets,
  fusekiConfig,
  splitFixtureByPod,
} from '../src/fuseki.js'

const podDatasets = fixturePodDatasets(
  [{ webId: 'https://id/acme', podBaseUrls: ['https://data/acme-rnd/'] }],
  'https://registry/'
)

describe('datasetForPod', () => {
  test('derives the dataset from a pod URL (path segment or subdomain)', () => {
    expect(datasetForPod('https://registry/acme/', 'registry')).toBe('reg-acme')
    expect(datasetForPod('https://data/alice-home/', 'data')).toBe('data-alice-home')
    // dev/demo subdomain form
    expect(datasetForPod('https://reg.docker/alice/', 'registry')).toBe('reg-alice')
    expect(datasetForPod('https://alice-home.data.docker/', 'data')).toBe('data-alice-home')
  })
})

describe('fixturePodDatasets', () => {
  test('maps registry + data pod URLs to dataset names', () => {
    expect(podDatasets.get('https://registry/acme/')).toBe('reg-acme')
    expect(podDatasets.get('https://data/acme-rnd/')).toBe('data-acme-rnd')
  })
})

describe('datasetForGraph', () => {
  const opts = { podDatasets }

  test('routes registry set graphs to reg-<handle> (meta: ignored)', () => {
    expect(datasetForGraph('https://registry/acme/authorization/k9m4vp', opts)).toBe('reg-acme')
    expect(datasetForGraph('meta:https://registry/acme/grant/', opts)).toBe('reg-acme')
  })

  test('routes data pod graphs to data-<pod>', () => {
    expect(datasetForGraph('https://data/acme-rnd/reb39k/', opts)).toBe('data-acme-rnd')
    expect(datasetForGraph('meta:https://data/acme-rnd/', opts)).toBe('data-acme-rnd')
  })

  test('routes public / cross-pod graphs to shared', () => {
    expect(datasetForGraph('https://registry/', opts)).toBe(SHARED_DATASET)
    expect(datasetForGraph('https://data/shapetrees/trees/Project', opts)).toBe(SHARED_DATASET)
    expect(datasetForGraph('https://data/test-client/public/id', opts)).toBe(SHARED_DATASET)
    expect(datasetForGraph('https://id/alice', opts)).toBe(SHARED_DATASET)
  })
})

describe('splitFixtureByPod', () => {
  const opts = {
    podDatasets: fixturePodDatasets(
      [{ webId: 'https://id/acme', podBaseUrls: ['https://data/acme-rnd/'] }],
      'https://registry/'
    ),
  }
  const fixture = `@prefix ex: <http://ex/> .
GRAPH <https://registry/acme/authorization/a1> { ex:s ex:p ex:o . }
GRAPH <meta:https://registry/acme/authorization/a1> { ex:s a ex:Resource . }
GRAPH <https://data/acme-rnd/r1> { ex:s2 ex:p ex:o . }
GRAPH <https://data/shapetrees/trees/Project> { ex:t ex:p ex:o . }
GRAPH <https://id/alice> { ex:me ex:p ex:o . }
`

  test('groups every graph into exactly one dataset', async () => {
    const split = await splitFixtureByPod(fixture, opts)
    expect([...split.keys()].toSorted()).toEqual(['data-acme-rnd', 'reg-acme', 'shared'])

    const reg = split.get('reg-acme')!
    expect(reg).toContain('https://registry/acme/authorization/a1')
    expect(reg).toContain('meta:https://registry/acme/authorization/a1')
    expect(reg).not.toContain('acme-rnd')

    const data = split.get('data-acme-rnd')!
    expect(data).toContain('https://data/acme-rnd/r1')
    expect(data).not.toContain('shapetrees')

    const shared = split.get('shared')!
    expect(shared).toContain('https://data/shapetrees/trees/Project')
    expect(shared).toContain('https://id/alice')
  })
})

describe('splitFixtureByPod — reciprocal mirror backfill', () => {
  const opts = {
    podDatasets: fixturePodDatasets(
      [
        { webId: 'https://id/acme', podBaseUrls: [] },
        { webId: 'https://id/alice', podBaseUrls: [] },
      ],
      'https://registry/'
    ),
  }
  const fixture = `@prefix interop: <http://www.w3.org/ns/solid/interop#> .
GRAPH <meta:https://registry/acme/social-agent/reg-acme/> {
  <https://registry/acme/social-agent/reg-acme/> a interop:SocialAgentRegistration ;
    interop:reciprocalRegistration <https://registry/alice/social-agent/reg-alice/> .
}
GRAPH <meta:https://registry/alice/social-agent/reg-alice/> {
  <https://registry/alice/social-agent/reg-alice/> a interop:SocialAgentRegistration ;
    interop:hasDataGrant <https://registry/alice/grant/g1> .
}
GRAPH <https://registry/alice/grant/g1> { <https://registry/alice/grant/g1> a interop:DataGrant . }
`

  test('copies the reciprocal target + its grants into the linking owner dataset', async () => {
    const split = await splitFixtureByPod(fixture, opts)
    const acme = split.get('reg-acme')!
    expect(acme).toContain('https://registry/acme/social-agent/reg-acme/')
    expect(acme).toContain('https://registry/alice/social-agent/reg-alice/')
    expect(acme).toContain('https://registry/alice/grant/g1')
    expect(split.get('reg-alice')!).not.toContain('reg-acme')
  })
})

describe('fusekiConfig', () => {
  test('renders one service + dataset per name', () => {
    const ttl = fusekiConfig(['shared', 'reg-alice', 'data-alice-home'])
    for (const name of ['shared', 'reg-alice', 'data-alice-home']) {
      expect(ttl).toContain(`fuseki:name "${name}"`)
      expect(ttl).toContain(`/fuseki-base/databases/${name}`)
    }
    expect(ttl.match(/rdf:type fuseki:Service/g)).toHaveLength(3)
    expect(ttl).toContain('fuseki:operation fuseki:query')
    expect(ttl).toContain('fuseki:operation fuseki:update')
    expect(ttl).toContain('fuseki:operation fuseki:gsp_rw')
  })
})
