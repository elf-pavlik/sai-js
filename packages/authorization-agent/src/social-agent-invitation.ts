import {
  type SocialAgentInvitationData,
  dataModelContext,
} from '@janeirodigital/interop-data-model'
import { type WhatwgFetch, putJsonLd, withContext } from '@janeirodigital/interop-utils'

// ──────────────────────────
// Write path: SocialAgentInvitationData → JSON-LD (PUT)
// ──────────────────────────

export async function putSocialAgentInvitation(
  data: SocialAgentInvitationData,
  fetch: WhatwgFetch
): Promise<void> {
  await putJsonLd(data.id, fetch, withContext(dataModelContext, data))
}

// ──────────────────────────
// Behavior functions (replacing class methods)
// ──────────────────────────

export async function setRegisteredAgent(
  data: SocialAgentInvitationData,
  fetch: WhatwgFetch,
  webId: string
): Promise<void> {
  data.registeredAgent = webId
  await putSocialAgentInvitation(data, fetch)
}
