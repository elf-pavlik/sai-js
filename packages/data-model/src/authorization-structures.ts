// ──────────────────────────
// Authorization structures (domain-shaped)
//
// Relocated from authorization-agent (payload-contract-alignment §2, decision
// (a2)): `data-model` is the anchor of the payload contract and must not
// import from authorization-agent, so the canonical shapes live here;
// authorization-agent re-exports them (source-compatible). The activity
// classes `AuthorizationRequested`/`ShareRequested` that could embed them
// were DROPPED (authorization-granting.md Decision A) — the granting carrier
// is the term-covered `DataAuthorizationData` POJO, so these structures are
// RPC-input types only, never on the wire.
// Fields stay domain-shaped plain-IRI strings — no `{ id, type }` refs,
// satisfying the storage law for SPARQL-queried registries.
// ──────────────────────────

/** One data authorization of an authorization (scope is the interop IRI). */
export type DataAuthorizationStructure = {
  accessNeed: string
  scopeOfAuthorization: string
  dataOwner?: string
  hasDataRegistration?: string
  hasDataInstance?: string[]
}

/** RPC-shaped authorization consumed by `recordAuthorizationFromStructure`. */
export type AuthorizationStructure = {
  grantee: string
  agentType: string
  hasAccessNeedGroup?: string
  granted: boolean
  dataAuthorizations?: DataAuthorizationStructure[]
}

// TODO: duplicates ShareAuthorization from api-messages (sai-impl-service)
export type ShareDataInstanceStructure = {
  applicationId: string
  resource: string
  accessMode: string[]
  children: {
    shapeTree: string
    accessMode: string[]
  }[]
  agents: string[]
}
