import * as effect from '@/effect'
import type {
  AccessAuthorization,
  AgentType,
  ApplicationList,
  Authorization,
  AuthorizationData,
  DataInstanceList,
  DataRegistryList,
  Resource,
  Role,
  RoleList,
  ShareAuthorization,
  ShareAuthorizationConfirmation,
  SocialAgent,
  SocialAgentInvitation,
  SocialAgentInvitationList,
  SocialAgentList,
  UnregisteredApplication,
} from '@janeirodigital/sai-api-messages'
import { IRI } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { useCoreStore } from './core'

export const useAppStore = defineStore('app', () => {
  const coreStore = useCoreStore()
  const lang = ref('en')
  /** the webId the UI currently operates in (org-admin context, §2.6) */
  const context = ref<string | null>(null)
  const resource = ref<S.Schema.Type<typeof Resource> | null>(null)
  const shareAuthorizationConfirmation = ref<S.Schema.Type<
    typeof ShareAuthorizationConfirmation
  > | null>(null)
  const authorizationData = ref<S.Schema.Type<typeof AuthorizationData> | null>(null)
  const accessAuthorization = ref<S.Schema.Type<typeof AccessAuthorization> | null>(null)
  const socialAgentList = ref<S.Schema.Type<typeof SocialAgentList>>([])
  const roleList = ref<S.Schema.Type<typeof RoleList>>([])
  const application = ref<S.Schema.Type<typeof UnregisteredApplication>>()
  const loadedDataInstances = reactive<Record<string, S.Schema.Type<typeof DataInstanceList>>>({})
  const applicationList = ref<S.Schema.Type<typeof ApplicationList>>([])
  const dataRegistryList = reactive<Record<string, S.Schema.Type<typeof DataRegistryList>>>({})
  const invitationList = ref<S.Schema.Type<S.mutable<typeof SocialAgentInvitationList>>>([])

  /** the context all registry-backed RPCs target — defaults to the user's own webId */
  function currentContext(): string {
    return context.value ?? coreStore.userId ?? ''
  }

  function setContext(webId: string | null) {
    context.value = webId
  }

  /**
   * Switchable contexts — the personal context plus each org the user
   * administers, derived from the personal-context `ListSocialAgents` list
   * (admin flag + label, §2.2/§2.6 of org-admin-feature.md).
   */
  const contexts = ref<{ webId: string; label: string }[]>([])

  async function listSocialAgents(force = false) {
    if (!socialAgentList.value.length || force) {
      socialAgentList.value = await effect.listSocialAgents(currentContext())
      // discovery: in the personal context the `admin` flags power the switcher
      if (currentContext() === coreStore.userId) {
        contexts.value = [
          { webId: coreStore.userId, label: coreStore.userId },
          ...socialAgentList.value
            .filter((agent) => agent.admin)
            .map((agent) => ({ webId: agent.id, label: agent.label })),
        ]
      }
    }
  }

  /** Switch the current context and re-target all registry-backed views. */
  async function switchContext(webId: string) {
    const previous = context.value
    setContext(webId)
    try {
      await listSocialAgents(true)
      await listApplications(true)
      await listRoles(true)
      await listSocialAgentInvitations(true)
    } catch (err) {
      // the context is no longer allowed (e.g. admin revoked) — revert
      console.error(err)
      setContext(previous)
      await listSocialAgents(true)
    }
  }


  async function getResource(resourceId: string) {
    resource.value = await effect.getResource(resourceId, lang.value, currentContext())
  }

  async function shareResource(shareAuthorization: S.Schema.Type<typeof ShareAuthorization>) {
    shareAuthorizationConfirmation.value = await effect.shareResource(
      shareAuthorization,
      currentContext()
    )
  }

  async function getAuthoriaztion(
    agentId: string,
    agentType: AgentType,
    preferredLang = lang.value,
    accessNeedGroupIri?: string
  ) {
    authorizationData.value = await effect.getAuthoriaztionData(
      agentId,
      agentType,
      preferredLang,
      currentContext(),
      accessNeedGroupIri
    )
  }

  // TODO rename list with load
  async function listDataInstances(agentId: string, registrationId: string) {
    const dataInstances = await effect.listDataInstances(
      IRI.make(agentId),
      IRI.make(registrationId),
      currentContext()
    )
    loadedDataInstances[registrationId] = [...dataInstances]
  }

  async function listApplications(force = false) {
    if (!applicationList.value.length || force) {
      applicationList.value = await effect.listApplications(currentContext())
    }
  }

  async function listRoles(force = false) {
    if (!roleList.value.length || force) {
      roleList.value = await effect.listRoles(currentContext())
    }
  }

  async function createRole(
    label: string,
    members: readonly S.Schema.Type<typeof IRI>[]
  ): Promise<S.Schema.Type<typeof Role>> {
    const role = await effect.createRole(label, members, currentContext())
    listRoles(true)
    return role
  }

  async function updateRole(
    id: S.Schema.Type<typeof IRI>,
    label: string,
    members: readonly S.Schema.Type<typeof IRI>[]
  ): Promise<S.Schema.Type<typeof Role>> {
    const role = await effect.updateRole(id, label, members, currentContext())
    listRoles(true)
    return role
  }

  async function deleteRole(id: S.Schema.Type<typeof IRI>): Promise<void> {
    await effect.deleteRole(id, currentContext())
    listRoles(true)
  }

  async function listSocialAgentInvitations(force = false) {
    if (!invitationList.value.length || force) {
      invitationList.value = [
        ...(await effect.listSocialAgentInvitations(currentContext())),
      ]
    }
  }

  async function authorizeApp(authorization: S.Schema.Type<typeof Authorization>) {
    accessAuthorization.value = await effect.authorizeApp(authorization, currentContext())
    listApplications(true)
    listSocialAgents(true)
    listRoles(true)
  }

  async function revokeGrants(grants: readonly S.Schema.Type<typeof IRI>[]) {
    await effect.revokeGrants(grants, currentContext())
    listSocialAgents(true)
    listApplications(true)
  }

  async function requestAccess(applicationId: string, agentId: string) {
    await effect.requestAccessUsingApplicationNeeds(applicationId, agentId, currentContext())
    listSocialAgents(true)
  }

  async function getUnregisteredApplication(applicationId: string) {
    application.value = await effect.getUnregisteredApplication(applicationId)
  }

  async function listDataRegistries(agentId: string, preferedLang = 'en') {
    const dataRegistries = await effect.listDataRegistries(agentId, preferedLang, currentContext())
    dataRegistryList[agentId] = [...dataRegistries]
  }

  async function createInvitation(
    label: string,
    note?: string
  ): Promise<S.Schema.Type<typeof SocialAgentInvitation>> {
    const socialAgentInvitation = await effect.createInvitation(label, note, currentContext())
    invitationList.value.push(socialAgentInvitation)
    return socialAgentInvitation
  }

  async function acceptInvitation(
    capabilityUrl: string,
    label: string,
    note?: string
  ): Promise<S.Schema.Type<typeof SocialAgent>> {
    const socialAgent = await effect.acceptInvitation(
      capabilityUrl,
      label,
      note,
      currentContext()
    )
    listSocialAgents(true)
    return socialAgent
  }

  /** Promote/demote an agent in the current (org) context — §2.6 toggle-admin. */
  async function toggleAdmin(webId: string, admin: boolean): Promise<void> {
    if (admin) await effect.addAdmin(webId, currentContext())
    else await effect.removeAdmin(webId, currentContext())
    listSocialAgents(true)
  }

  return {
    lang,
    context,
    contexts,
    resource,
    authorizationData,
    accessAuthorization,
    loadedDataInstances,
    socialAgentList,
    roleList,
    application,
    applicationList,
    dataRegistryList,
    shareAuthorizationConfirmation,
    invitationList,
    setContext,
    switchContext,
    currentContext,
    toggleAdmin,
    getResource,
    shareResource,
    getAuthoriaztion,
    listDataInstances,
    authorizeApp,
    revokeGrants,
    requestAccess,
    listSocialAgents,
    listRoles,
    createRole,
    updateRole,
    deleteRole,
    getUnregisteredApplication,
    listApplications,
    listDataRegistries,
    createInvitation,
    listSocialAgentInvitations,
    acceptInvitation,
  }
})
