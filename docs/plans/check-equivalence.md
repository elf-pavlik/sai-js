# Real `checkEquivalence` — reuse equivalent grants

> **Status:** design only. The dummy (`{ reused: [] }`) shipped in
> `refactor-grants-workflows.md`; the real implementation was that plan's
> "Future step" and is **Phase 4.5** of `workflow-temporal-decupling.md`. This
> standalone plan is now where the real `checkEquivalence` is tracked.

## 1. Problem

Today every regeneration is "generate everything, store everything":

- `generateGrants` produces new grant data (source + delegated) with **fresh
  IRIs** on every run.
- `checkEquivalence` is a dummy → `{ reused: [] }` → the workflow stores every
  generated grant (new `DataGrant` resources + new ACRs), requests every
  delegation again, and re-links the registration with the **new** IRIs.
- Result: an unchanged authorization state (e.g. the same role membership, a
  re-run of the per-target consumer over a burst, or the reconciliation sweep
  re-processing a `pending` activity) **recreates the whole grant set** — new
  resources, new ACRs, new delegated grants on the data owners' registries —
  while the old resources stay behind as orphans (the HTTP-DELETE of old
  grants is commented out, see §6).

Reuse is the fix: when a generated grant is **equivalent** to an existing one,
keep the existing resource + ACR and re-link its id on the registration.

## 2. Current wiring (as-is)

**Activity** (`packages/components/src/temporal/activities/grants.ts`):

```ts
export interface CheckEquivalenceInput {
  webId: SocialAgentId
  grantee: AgentId
  generated: GeneratedGrants      // { sourceGrants: GrantData[], delegatedGrants: GrantData[] }
  existing: GrantData[]           // the grantee's current grants (from getExistingGrants)
}
export interface EquivalenceResult {
  reused: { existing: GrantId; generated: GrantData }[]   // existing = { id, type }
}
export async function checkEquivalence(_payload: CheckEquivalenceInput): Promise<EquivalenceResult> {
  return { reused: [] }   // DUMMY
}
```

**Workflow** (`temporal/workflows/grants.ts`, `createGrantsForAgent`) — already
fully wired for reuse:

```ts
const { reused } = await checkEquivalence({ webId, grantee, generated, existing })
const reusedGenerated = new Set(reused.map((e) => e.generated))
const reusedExistingIds = new Set(reused.map((e) => e.existing.id))
// store:        for grant of generated.sourceGrants      → skip if reusedGenerated.has(grant)
// delegation:   for grant of generated.delegatedGrants   → skip if reusedGenerated.has(grant)
// delete (⚠️ commented out — §6): existing not in reusedExistingIds
// registration: replaceDataGrantsOnRegistration({ grants: [...newGrantIds, ...reused.map((e) => e.existing)] })
```

So the workflow needs **no changes** — only `checkEquivalence` returns real
results.

## 3. Target: the real comparison

For each generated grant (source and delegated, **including child grants**),
find an existing grant whose **semantic fields are equal**; pair them.

### 3.1 Compared fields

Equal iff all of the following match (`GrantData` / `FinalGrantData`):

- `grantee`
- `grantedBy`
- `dataOwner`
- `registeredShapeTree`
- `hasDataRegistration`
- `hasStorage`
- `scopeOfGrant`
- `accessMode` (as a set)
- `creatorAccessMode` (as a set, when present)
- `hasDataInstance` (as a set, when present)
- `delegationOfGrant` — **excluded for delegated grants** (§3.4)

### 3.2 Child grant trees

A parent grant's equivalence includes its children (`hasInheritingGrant` /
`inheritsFromGrant`): match the **parent and its children as a unit** — the
generated parent matches an existing parent only if the existing parent's
children are equivalent (by the same field comparison, on the child's
`registeredShapeTree`, `accessMode`, `creatorAccessMode`, `hasDataInstance`,
`hasDataRegistration`) and the child sets have the same shape-tree composition.
Child IRIs are not compared (they are derived, like the parent's).

### 3.3 Matching algorithm

- Normalize sets (`accessMode`, `creatorAccessMode`, `hasDataInstance`) before
  comparing.
- Match **one-to-one, greedily**: iterate generated grants, find the first
  unclaimed existing grant with equal fields. (O(n·m) is fine — grant sets are
  small.)
- `type` is not compared (always `[INTEROP.DataGrant]`).

### 3.4 Delegated grants — the `delegationOfGrant` wrinkle

`generateDelegatedDataGrants` sets `delegationOfGrant: sourceGrant.id!` — the
**freshly generated** source grant's IRI. On a re-run that id never equals the
existing delegated grant's `delegationOfGrant` (which points to the *old*
source grant). Therefore:

- **Exclude `delegationOfGrant` from the comparison** for delegated grants;
  match on the other fields only.
- **Linkage caveat (documented):** if a source grant is *reused* while its
  delegated grants are *not* (or vice versa), a reused delegated grant's
  `delegationOfGrant` can point at the old source grant. In the common case
  (nothing changed) the whole chain is reused coherently, so the link stays
  valid. A follow-up could match **chains** (a delegated grant is reused only
  if its delegation source is also reused) — not needed for the first cut.

## 4. What reuse means downstream (already wired)

For every `{ existing, generated }` pair:

- **Store**: the generated counterpart is skipped — no new resource, no new ACR
  (`createAcr` not called for it).
- **Delete**: the existing grant is skipped by `reusedExistingIds` — its
  resource and ACR stay in place.
- **Registration**: `replaceDataGrantsOnRegistration` re-links the **existing**
  id (`[...newGrantIds, ...reused.map((e) => e.existing)]`).

Net effect on an unchanged re-run: **zero new grant resources, zero new ACRs,
zero delegation requests** — the registration's `hasDataGrant` set is unchanged
(after the single-PATCH diff, the PATCH is even a no-op).

## 5. Implementation steps

1. **`checkEquivalence` activity** (`activities/grants.ts`): implement the field
   comparison (§3) — a helper `grantsEqual(a, b, { includeDelegationOfGrant })`
   plus the child-tree matching (§3.2), and the greedy one-to-one pairing
   (§3.3). Return `{ reused }`.
2. **No workflow changes** — `createGrantsForAgent` already consumes `reused`.
3. **No data-model changes** — the comparison reads `GrantData` fields directly.

## 6. Interaction with the commented-out grant deletion

The old-resource HTTP-DELETE in `createGrantsForAgent` is **commented out**
(CSS 403 on grantor-side DELETE of delegated grants — see
`refactor-grants-workflows.md` design decision 3). Reuse does **not** fix that:
non-equivalent old grants remain orphaned. What reuse changes:

- an unchanged re-run produces **no new orphans** (nothing is replaced);
- when grants actually change, the replaced ones still orphan (unchanged
  behavior until the DELETE 403 is resolved).

## 7. Testing

- **No-new-IRI-on-rerun**: run a regeneration twice with an unchanged
  authorization state and assert the registration's `hasDataGrant` set is
  **identical** (same IRIs) after the second run. Natural triggers: two
  identical `authorizationRecorded` activities (consumer coalesces, but a
  manual re-run via the reconciliation sweep reproduces it), or re-running the
  sweep on a `done`… no — on a **pending** activity after an unchanged
  regeneration.
- **Change → replace**: change one authorization and assert the changed grant
  is new while the unaffected grants keep their IRIs (partial reuse).
- **Delegated reuse**: a yoyo-delegated grant survives a re-run with the same
  IRI (covers §3.4).
- Extend `roles.test.ts` or a new `check-equivalence.test.ts`; the existing
  suite stays green (dummy → real is outcome-neutral when nothing is asserted
  about IRIs).

## 8. Out of scope / follow-ups

- Resolving the DELETE 403 (old-resource cleanup) — `refactor-grants-workflows.md`
  design decision 3.
- Chain-consistent reuse (delegated grant reused only with its source) — §3.4.
- Whole-registry regeneration (recovery scenarios only).
