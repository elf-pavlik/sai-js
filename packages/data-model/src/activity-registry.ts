// ──────────────────────────
// Types
// ──────────────────────────

export type ActivityRegistryData = {
  id: string
}

/**
 * An activity resource in the Activity Registry (the outbox): producers PUT
 * one per change that needs a follow-up workflow; the main agent's webhook
 * handler reads `activityType` + `payload` and starts the corresponding
 * workflow. `payload` is the ready-made workflow input (JSON).
 */
export type ActivityData = {
  id: string
  activityType: string
  /** IRI of the changed record (or container) that triggered the activity */
  target: string
  /** ready-made workflow input the producer builds at write time */
  payload: unknown
  createdAt: string
}
