import {
  INTEROP,
  RDF,
  SKOS,
  type WhatwgFetch,
  discoverAgentRegistration,
  discoverAuthorizationAgent,
  fetchJsonLd,
  frameDoc,
} from '@janeirodigital/interop-utils'
import { DataFactory, type Store } from 'n3'
import type { AuthorizationAgentFactory } from '..'
import { dataModelContext } from '../context'
import {
  type AgentRegistrationId,
  toDataset as registrationToDataset,
} from './agent-registration'
import { addStatement, createContainer, replaceStatement } from './container'

// ──────────────────────────
// Types
// ──────────────────────────

export type SocialAgentRegistrationId = AgentRegistrationId

export type SocialAgentRegistrationData = SocialAgentRegistrationId & {
  registeredAgent: string
  hasDataGrant?: string[]
  prefLabel: string
  note?: string
  hasAccessNeedGroup?: string
  /** IRI of the peer's reciprocal registration — loaded lazily, see `loadReciprocalRegistration` */
  reciprocalRegistration?: string
}

/** Identity of a social agent (boundary-facing; produced by the agent registries). */
export type SocialAgentId = {
  id: string
  /** rdf:type IRIs — always `[INTEROP.SocialAgent]` when produced by the registries */
  type: string[]
}

// ──────────────────────────
// Read path: JSON-LD → SocialAgentRegistrationData
// ──────────────────────────

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into a
 * SocialAgentRegistrationData POJO.
 *
 * The document can be in expanded, compacted, or flattened form. Uses
 * jsonld.frame with the shared data model context: node references
 * (`registeredAgent`, `hasAccessNeedGroup`, `reciprocalRegistration`) are
 * coerced to strings via `@type: '@id'`, `hasDataGrant` to a string array via
 * `@type: '@id'` + `@container: '@set'`, literals to plain strings, and the
 * rdf:type (from framing) to a string array.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<SocialAgentRegistrationData> {
  const node = (await frameDoc(doc, dataModelContext, iri)) as any
  return {
    id: iri,
    type: node.type ? (Array.isArray(node.type) ? node.type : [node.type]) : [],
    registeredAgent: node.registeredAgent,
    hasDataGrant: node.hasDataGrant ?? [],
    prefLabel: node.prefLabel ?? '',
    // @omitDefault omits framed-but-absent properties — normalize to undefined anyway
    note: node.note ?? undefined,
    hasAccessNeedGroup: node.hasAccessNeedGroup ?? undefined,
    reciprocalRegistration: node.reciprocalRegistration ?? undefined,
  }
}

export async function loadSocialAgentRegistration(
  iri: string,
  fetch: WhatwgFetch
): Promise<SocialAgentRegistrationData> {
  return fromJsonLd(await fetchJsonLd(iri, fetch), iri)
}

/**
 * Lazily load the peer's reciprocal registration — only consumers that need its
 * data (`hasAccessNeedGroup`, data grants) call this. The leaf read
 * (`loadSocialAgentRegistration`) no longer recurses into the reciprocal.
 */
export async function loadReciprocalRegistration(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<SocialAgentRegistrationData | undefined> {
  if (!data.reciprocalRegistration) return undefined
  return factory.socialAgentRegistration(data.reciprocalRegistration)
}

// ──────────────────────────
// Write path: SocialAgentRegistrationData → Dataset
// ──────────────────────────

export async function toDataset(data: SocialAgentRegistrationData): Promise<Store> {
  const store = await registrationToDataset(data)
  const node = DataFactory.namedNode(data.id)
  store.add(DataFactory.quad(node, SKOS.terms.prefLabel, DataFactory.literal(data.prefLabel)))
  if (data.note) {
    store.add(DataFactory.quad(node, SKOS.terms.note, DataFactory.literal(data.note)))
  }
  if (data.hasAccessNeedGroup) {
    store.add(
      DataFactory.quad(
        node,
        INTEROP.terms.hasAccessNeedGroup,
        DataFactory.namedNode(data.hasAccessNeedGroup)
      )
    )
  }
  return store
}

export async function createSocialAgentRegistration(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory
): Promise<void> {
  const dataset = await toDataset(data)
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(data.id),
      RDF.terms.type,
      INTEROP.terms.SocialAgentRegistration
    )
  )
  await createContainer(data.id, factory, dataset)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function discoverReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  fetch: WhatwgFetch
): Promise<string | null> {
  const authrizationAgentIri = await discoverAuthorizationAgent(data.registeredAgent, factory.fetch)
  if (!authrizationAgentIri) return null
  return discoverAgentRegistration(authrizationAgentIri, fetch)
}

async function updateReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  reciprocalRegistrationIri: string
): Promise<void> {
  const node = DataFactory.namedNode(data.id)
  const quad = DataFactory.quad(
    node,
    INTEROP.terms.reciprocalRegistration,
    DataFactory.namedNode(reciprocalRegistrationIri)
  )
  if (data.reciprocalRegistration) {
    const priorQuad = DataFactory.quad(
      node,
      INTEROP.terms.reciprocalRegistration,
      DataFactory.namedNode(data.reciprocalRegistration)
    )
    await replaceStatement(data.id, factory, priorQuad, quad)
  } else {
    await addStatement(data.id, factory, quad)
  }
  data.reciprocalRegistration = reciprocalRegistrationIri
}

export async function discoverAndUpdateReciprocal(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  fetch: WhatwgFetch
): Promise<void> {
  const reciprocalRegistrationIri = await discoverReciprocal(data, factory, fetch)
  if (reciprocalRegistrationIri) {
    await updateReciprocal(data, factory, reciprocalRegistrationIri)
  }
}

export async function setAccessNeedGroup(
  data: SocialAgentRegistrationData,
  factory: AuthorizationAgentFactory,
  accessNeedGroupIri: string
): Promise<void> {
  const node = DataFactory.namedNode(data.id)
  const quad = DataFactory.quad(
    node,
    INTEROP.terms.hasAccessNeedGroup,
    DataFactory.namedNode(accessNeedGroupIri)
  )
  if (data.hasAccessNeedGroup) {
    const priorQuad = DataFactory.quad(
      node,
      INTEROP.terms.hasAccessNeedGroup,
      DataFactory.namedNode(data.hasAccessNeedGroup)
    )
    await replaceStatement(data.id, factory, priorQuad, quad)
  } else {
    await addStatement(data.id, factory, quad)
  }
  data.hasAccessNeedGroup = accessNeedGroupIri
}
