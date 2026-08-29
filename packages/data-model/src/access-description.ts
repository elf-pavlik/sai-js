// ──────────────────────────
// Types (shared base of the need/group description modules)
// ──────────────────────────

/** Identity of an access description. */
export type AccessDescriptionId = {
  id: string
  /** rdf:type IRIs — captured from framing on read */
  type: string[]
}

/** Plain JSON representation of an access description (need or group). */
export type AccessDescriptionData = AccessDescriptionId & {
  // TODO handle missing labels
  prefLabel: string
  definition?: string
}