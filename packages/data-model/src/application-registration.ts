import type { DatasetCore } from '@rdfjs/types'
import { Store } from 'n3'
import type { GrantData, BaseFactory } from '.'
import { frameDataset, frameDoc, toStore, withContext } from './jsonld-utils'

const applicationRegistrationContext = {
  id: '@id',
  type: '@type',
  registeredAgent: {
    '@id': 'http://www.w3.org/ns/solid/interop#registeredAgent',
    '@type': '@id',
  },
  hasDataGrant: {
    '@id': 'http://www.w3.org/ns/solid/interop#hasDataGrant',
    '@type': '@id',
    '@container': '@set',
  },
}

// ──────────────────────────
// Types
// ──────────────────────────

/** Plain JSON representation of an Application Registration. */
export type ApplicationRegistrationData = {
  id: string
  registeredAgent: string
  hasDataGrant: string[]
  /** Whether the registration has any data grants (derived from hasDataGrant). */
  granted: boolean
}

// ──────────────────────────
// Read path: Dataset / JSON-LD → ApplicationRegistrationData
// ──────────────────────────

/**
 * Convert a parsed RDF dataset into an ApplicationRegistrationData POJO.
 * Uses jsonld.frame with the applicationRegistrationContext.
 */
export async function fromDataset(
  dataset: DatasetCore,
  iri: string
): Promise<ApplicationRegistrationData> {
  return compactNodeToApplicationRegistrationData(
    (await frameDataset(dataset, applicationRegistrationContext, iri)) as any
  )
}

/**
 * Convert a JSON-LD document (fetched as application/ld+json) directly into an
 * ApplicationRegistrationData POJO. The document can be in expanded, compacted,
 * or flattened form.
 */
export async function fromJsonLd(doc: unknown, iri: string): Promise<ApplicationRegistrationData> {
  return compactNodeToApplicationRegistrationData(
    (await frameDoc(doc, applicationRegistrationContext, iri)) as any
  )
}

function compactNodeToApplicationRegistrationData(node: any): ApplicationRegistrationData {
  const hasDataGrant = node.hasDataGrant ?? []
  return {
    id: node.id ?? node['@id'],
    registeredAgent: node.registeredAgent,
    hasDataGrant,
    granted: hasDataGrant.length > 0,
  }
}

// ──────────────────────────
// Write path: ApplicationRegistrationData → Dataset / JSON-LD
// ──────────────────────────

/** Convert an ApplicationRegistrationData to an N3 Store (DatasetCore). */
export async function toDataset(data: ApplicationRegistrationData): Promise<Store> {
  return toStore(toJsonLd(data), data.id)
}

/**
 * Build a JSON-LD document (with embedded context) ready for PUT as
 * application/ld+json. The derived `granted` field is not an RDF property,
 * so it is stripped from the serialized document.
 */
export function toJsonLd(data: ApplicationRegistrationData): Record<string, unknown> {
  const { granted: _granted, ...rest } = data
  return withContext(applicationRegistrationContext, rest)
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

/** Whether the registration has any data grants. */
export function getGranted(data: ApplicationRegistrationData): boolean {
  return data.hasDataGrant.length > 0
}

/** Fetch all data grants of this application registration. */
export async function getDataGrants(
  data: ApplicationRegistrationData,
  factory: BaseFactory
): Promise<GrantData[]> {
  return Promise.all(data.hasDataGrant.map((iri) => factory.readable.dataGrant(iri)))
}
