# Federation notes

> **Status:** design notes. Documents the **single-deployment shortcuts** the
> current implementation takes and the cases that will need real federation.
> Some of these shortcuts are load-bearing for org-admin (below); they are
> acceptable for now and flagged as TODO/future work, not blocking.

## Why these notes exist

The org-admin feature (see `org-admin-feature.md`) is the first feature that
**crosses servers in the data plane**: an admin of an org operates on the org's
registries (possibly on a different server than the admin's), and admin grants
on **data registries** are consumed by the permission engine on the **data
server**. That exposes assumptions that hold only while all three CSS servers
(auth, registry, data) share one deployment.

## Current shortcuts (to be fixed later)

### 1. One shared SPARQL endpoint / triple store

`urn:solid-server:default:variable:sparqlEndpoint` is per-server configuration,
but today the registry and data servers point at **the same triple store**
(PostgreSQL). Several components depend on that:

- `SaiAuthorizationManager.getAuthorizationData` runs **one** query with no
  graph restriction (`GRAPH ?g {?s <interop:hasStorage> <storage>}`) and
  expects every grant that mentions `hasStorage` — wherever its graph lives —
  to be visible from the data server's endpoint.
- AdminGrants with `scopeOfAdminGrant interop:DataRegistry` carry
  `hasStorage` = the data registry, so the data server's engine collects them
  **through the same query** — this only works because the org's GrantRegistry
  graph is in the same store the data server queries.
- `GrantIssuanceHandler.validateDelegable` queries the data owner's registry
  the same way (cross-server grant lookup assumed impossible without this).
- **Org-context reads (phases 2–3 of `org-context-sparql.md`) query peer
  graphs directly** from this shared store — reciprocal registrations and
  their data grants are read cross-graph instead of being dereferenced over
  HTTP. This shortcut silently stands in for replication: the moment stores
  split per owner (phase 4b), those graphs vanish from the org's endpoint
  and the **local reciprocal mirrors become load-bearing** (see below).

**Future:** federated SPARQL endpoints / per-server query fan-out, or an
explicit cross-server grant lookup. TODO — not blocking the current
single-store deployments.

### 1a. Reciprocal mirroring is the federated replacement for cross-graph reads

`org-context-sparql.md` phase 1 + `isolated-datasets-and-sparql.md` 4b
introduce local read-only copies of the
peer-side data org-context reads need: each org mirrors its peers'
reciprocal registrations (+ linked data grants) into graphs named after the
source resource IRIs, kept fresh by webhook-driven `syncReciprocalMirror`
workflows. In a federated deployment this is not an optimization but the
**only** source for those reads:

- the org's store contains nothing about peers except what the org mirrored;
- freshness is eventually-consistent via webhook delivery (depends on
  shortcut 5 / `durable-webhook-delivery.md`);
- **the sync workflows are implemented but disabled until the per-owner
  cutover** — with one shared store, mirror graphs would collide with the
  live peer graphs of the same name;
- existing registrations need a one-time **backfill** before any per-owner
  cutover — a listed prerequisite of `isolated-datasets-and-sparql.md`
  phase 4b;
- unregister propagation (mirror deletion when a peer removes the
  registration) has no flow yet and must exist before 4b as well.

### 2. UAS / storage discovery uses the global `fetch`

`SaiPermissionsEngine` and `AdminPermissionReader` call
`discoverAuthorizationAgent(agent, fetch)` with the **global** fetch (not a
session-bound fetch), and `findResourceOwner` in the authorization agent does
`discoverStorageDescription` over `https`. In a deployment where the WebID
profiles / storage descriptions live on other hosts, this relies on those hosts
being reachable and on DNS; today they are in the same compose network.
Revisit when servers are actually split across hosts.

### 3. Pod/storage ownership is local

`AdminPermissionReader.requestFromAdmin` decides "owner of this storage" via
the **local** `podStore.getOwners(storage.id)`. That is correct per-server
today because the pod store mirrors the local single store. In federation, the
data server must either mirror storage ownership of remote orgs or resolve it
on the wire (e.g. via the org's agent-id document / registry set).

### 4. Across servers: the org's Authorization Agent serves the registry-set link

Already designed in `org-admin-feature.md` §2.4 (C2): the **org's** AA may live
on a different server than the **admin's**. The org's AA serves the org's
agent-id document, the admin-only `Link: <registrySet>; rel="interop:hasRegistrySet"`
response header, and runs the org's Activity Registry workflows. The admin's AA
performs the UI interactions. This is the *intended* federation shape for the
registry plane; the header carries the authoritative RegistrySet IRI across
servers.

### 5. Activity/outbox delivery assumes one notification path

`ActivityWebhookHandler` (auth server) receives webhook notifications from the
org's Activity Registry. In the federated case the org's Activity Registry lives
behind the org's AA; observing it and forwarding events to the admin's UI is
Phase 3 of `org-admin-feature.md` and depends on `durable-webhook-delivery.md`
for cross-server webhook delivery.

## Cases the design must keep working when federation lands

- **Admin status check from the data plane.** Data-server enforcement reads
  AdminGrants from the org's GrantRegistry (registry plane). The engine cannot
  see registry ACRs (different server, different enforcement layer by design) —
  so the admin decision must come from grants, discoverable from the data
  server (shortcut 1) until federated lookup exists.
- **Storage → org resolution.** The engine must map a target registry/storage to
  the owning RegistrySet to know which AdminGrants apply. Today that falls out
  of `hasStorage` matching; in federation it may need the registry-set link or
  a storage-ownership registry.
- **Webhook/Activity cross-server delivery** (shortcut 5) so admin UI events
  don't depend on co-location.
- **Mirror completeness at per-owner cutover** (shortcut 1a): every live
  reciprocal registration must be mirrored and fresh before an org moves to
  its own store — otherwise org-context views silently lose peer-derived
  rows (labels, access-requested flags, grants).