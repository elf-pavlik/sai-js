// ──────────────────────────
// Types
// ──────────────────────────

/**
 * Plain JSON representation of an access description set resource.
 *
 * The set's own data is only its identity; the description IRIs it groups are
 * derived from its dataset (see the AA `access-description-set` module), and
 * the description POJOs are resolved via `loadDescriptions` there.
 */
export type AccessDescriptionSetData = {
  id: string
}
