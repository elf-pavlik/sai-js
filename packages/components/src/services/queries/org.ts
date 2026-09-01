import {
  type SparqlBindingTerm,
  type SparqlTransport,
  findApplicationRegistration,
  findSocialAgentInvitation,
  findSocialAgentRegistration,
  getApplicationRegistration,
  getDataAuthorization,
  getDataGrant,
  getDataRegistration,
  getRole,
  getSocialAgentInvitation,
  getSocialAgentRegistration,
  listContained,
  listDataRegistrations,
  localSparqlTransport,
} from '@janeirodigital/interop-authorization-agent'
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import { discoverAuthorizationAgent, parseTurtle } from '@janeirodigital/interop-utils'
import type { ResolvedContext } from '../Context.js'

// The transport abstraction + registry queries live in the
// authorization-agent package (it owns `sparqlEndpoint`); this module adds
// the org-context `/sparql-admin` transport and the context dispatch.
export {
  findApplicationRegistration,
  findSocialAgentInvitation,
  findSocialAgentRegistration,
  getApplicationRegistration,
  getDataAuthorization,
  getDataGrant,
  getDataRegistration,
  getRole,
  getSocialAgentInvitation,
  getSocialAgentRegistration,
  listContained,
  listDataRegistrations,
}
export type { SparqlTransport }

// ──────────────────────────
// SPARQL admin transport (org context)
// ──────────────────────────

/**
 * Send a SPARQL query to the org's `/sparql-admin` endpoint via HTTP
 * `QUERY`, authenticated as the admin (the caller's own session — the only
 * session the admin's server holds). `QUERY` is the safe, read-only method
 * (draft-ietf-httpapi-safe-methods-wg); it is DPoP-verifiable since
 * `@solid/access-token-verifier` 2.1.2 added it to its `REQUEST_METHOD`
 * whitelist.
 */
async function adminSparqlQuery(
  adminSession: AuthorizationAgent,
  orgWebId: string,
  query: string
): Promise<Response> {
  let orgAA: string | undefined
  try {
    orgAA = await discoverAuthorizationAgent(orgWebId, adminSession.fetch)
  } catch {
    throw new Error(`cannot discover authorization agent for ${orgWebId}`)
  }
  if (!orgAA) {
    throw new Error(`cannot discover authorization agent for ${orgWebId}`)
  }
  const url = `${new URL(orgAA).origin}/.sai/sparql-admin/${Buffer.from(orgWebId).toString('base64url')}`
  const response = await adminSession.fetch(url, {
    method: 'QUERY',
    headers: {
      'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json, text/turtle',
    },
    body: query,
  })
  if (!response.ok) {
    throw new Error(`sparql-admin ${response.status} for ${orgWebId}: ${await response.text()}`)
  }
  return response
}

/** W3C SPARQL JSON-results term → minimal RDF/JS-style term. */
function termFromJson(term: Record<string, string>): SparqlBindingTerm {
  switch (term.type) {
    case 'uri':
      return { termType: 'NamedNode', value: term.value }
    case 'bnode':
      return { termType: 'BlankNode', value: term.value }
    case 'literal': {
      const language = term['xml:lang']
      if (language) {
        return {
          termType: 'Literal',
          value: term.value,
          language,
          datatype: {
            termType: 'NamedNode',
            value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
          },
        }
      }
      return {
        termType: 'Literal',
        value: term.value,
        language: '',
        datatype: {
          termType: 'NamedNode',
          value: term.datatype ?? 'http://www.w3.org/2001/XMLSchema#string',
        },
      }
    }
    default:
      throw new Error(`unknown SPARQL result term: ${JSON.stringify(term)}`)
  }
}

/**
 * Query runner against the org's `/sparql-admin` endpoint
 * (`AdminSparqlHandler`: SELECT → `application/sparql-results+json`,
 * CONSTRUCT → `text/turtle`; updates rejected).
 */
function adminSparqlTransport(adminSession: AuthorizationAgent, orgWebId: string): SparqlTransport {
  return {
    async fetchBindings(query) {
      const response = await adminSparqlQuery(adminSession, orgWebId, query)
      const json = (await response.json()) as {
        head: { vars: string[] }
        results?: { bindings: Record<string, Record<string, string>>[] }
        boolean?: boolean
      }
      if (json.boolean !== undefined) {
        throw new Error(`unexpected ASK result for query: ${query}`)
      }
      return (json.results?.bindings ?? []).map((binding) =>
        Object.fromEntries(
          Object.entries(binding).map(([name, term]) => [name, termFromJson(term)])
        )
      )
    },
    async fetchTriples(query) {
      const response = await adminSparqlQuery(adminSession, orgWebId, query)
      return parseTurtle(await response.text())
    },
  }
}

/**
 * The registry-plane transport for a resolved context: personal context
 * reads the user's own store via the session's internal endpoint; org
 * context queries the org's `/sparql-admin` over HTTP as the admin
 * (cross-server in real deployments, same-origin in the single-server
 * dev/test env — the shared store makes both resolve the org's graphs).
 * Same queries on both transports (docs/sparql.md).
 */
export function sparqlTransportFor(ctx: ResolvedContext): SparqlTransport {
  return ctx.webId === ctx.userWebId
    ? localSparqlTransport(ctx.session.sparqlEndpoint)
    : adminSparqlTransport(ctx.session, ctx.webId)
}
