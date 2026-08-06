# Refactor data-model — DataInstance

> Extracted from **Phase 4** of [`refactor-data-model-followup.md`](refactor-data-model-followup.md). That plan's Phases 1–3 converted the CRUD domain resources to JSON-LD POJOs (raw JSON-LD GET/PUT, SPARQL patches via module functions); DataInstance is the remaining model with a **mixed PUT/PATCH/blob write side** and a **write-side class that is today unused in production** — so it gets its own plan and scope decision.

## Current shape

- **Read**: `DataInstanceData` POJO (id, shapeTreeIri, label, isBlob, children, dataRegistration) built via `factory.readable.dataInstance`; `fetchDataInstanceDataset` = raw JSON-LD GET + `parseJsonld` → **N3 Store** (still quad-based for `computeLabel`/`computeChildren`).
- **Write**: `DataInstance` class — **now standalone** (no longer extends `ReadableResource`; the `Resource`/`ReadableResource` base classes in `src/resource.ts` were deleted — `DataInstance` was their only subclass, it now initializes `iri`/`node`/`factory`/`fetch`/`dataset` itself and uses the `getOneMatchingQuad`/`getAllMatchingQuads`/`fetchDataInstanceDataset` module functions) — blob PUT/PATCH (`insertPatch` SPARQL), RDF PUT (`dataset`), child-reference add/remove (full PUT of `this.dataset`), DELETE. `newDataInstance`/`getDataInstanceIterator` in `grant.ts`; `ReadableDataRegistrationProxy` in `data-registration-proxy.ts` (constructed by `data-owner.selectRegistrations`).
- **Consumers**: components `DataRegistry.listDataInstances` (iteration + `readable.dataInstance` — read only), authorization-agent `findAgentsWithAccess`/`shareDataInstance` (readable).

## Steps / decisions

1. **Scope decision (write-side class)** — survey result: no production consumer calls the write-side class (`newDataInstance`, `.update()`, `.delete()`) — only `getDataInstanceIterator` yields class instances for `.iri` (the components code immediately re-reads via `readable.dataInstance`). Decide:
   - (a) keep the class for future write needs,
   - (b) reduce iteration to the read POJO and drop the class, or
   - (c) defer the write side entirely.
   **Partial — ✅**: the class is now **standalone** (zero class-hierarchy dependency): `extends ReadableResource` removed, `Resource`/`ReadableResource` deleted with `src/resource.ts` + their tests (`resource.test.ts`, `readable/resource.test.ts`); the write-side class itself is kept (option a) pending the read-path work in step 2.
2. **Read path N3-free** — replace `computeLabel`/`computeChildren` quad lookups with framed JSON-LD values (the `describesInstance`/`viaPredicate` predicates via a data-instance context); `fetchDataInstanceDataset` → `fromJsonLd` (jsonld-utils `frameDoc`).
3. Whatever remains (blob SPARQL patch, child-reference patches) stays on the quad infra from the follow-up plan's Phase 3.
4. **Test consolidation** — root `data-instance.test.ts` (write-side class `DataInstance.build`) + `readable/data-instance.test.ts` (POJO read, mostly skipped) — resolve together with the scope decision in step 1 (follow-up plan's Phase 5 §4).
