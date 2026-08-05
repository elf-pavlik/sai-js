import repl from 'node:repl'
import { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent'
import {
  AgentRegistry,
  AuthorizationRegistry,
  DataRegistry,
  GrantRegistry,
  type RegistrySetData,
  RoleRegistry,
} from '@janeirodigital/interop-data-model'
import { init } from '@paralleldrive/cuid2'

import {
  type Account,
  SolidTestUtils,
  accounts,
  createApp,
  shapeTree,
} from '@janeirodigital/css-test-utils'

global.shapeTrees = shapeTree

global.cuid = init({ length: 6 })

global.bootstrapAccount = async function bootstrapAccount(
  account: Account,
  session: AuthorizationAgent
): Promise<RegistrySetData> {
  const uriForContained = function uriForContained(containerId: string, container = false): string {
    const id = containerId + global.cuid()
    return container ? `${id}/` : id
  }

  // create Agent Registry
  const agentRegistryId = uriForContained(account.auth, true)
  const agentRegistry = await session.factory.crud.agentRegistry(agentRegistryId)
  await AgentRegistry.createAgentRegistry(agentRegistry, session.factory)

  // create Authorization Registry
  const authorizationRegistryId = uriForContained(account.auth, true)
  const authorizationRegistry = await session.factory.crud.authorizationRegistry(
    authorizationRegistryId
  )
  await AuthorizationRegistry.createAuthorizationRegistry(authorizationRegistry, session.factory)

  // create Role Registry
  const roleRegistryId = uriForContained(account.auth, true)
  const roleRegistry = await session.factory.crud.roleRegistry(roleRegistryId)
  await RoleRegistry.createRoleRegistry(roleRegistry, session.factory)

  // create Grant Registry
  const grantRegistryId = uriForContained(account.auth, true)
  const grantRegistry = await session.factory.crud.grantRegistry(grantRegistryId)
  await GrantRegistry.createGrantRegistry(grantRegistry, session.factory)

  const registrySetData = {
    hasAgentRegistry: agentRegistry.id,
    hasAuthorizationRegistry: authorizationRegistry.id,
    hasRoleRegistry: roleRegistry.id,
    hasGrantRegistry: grantRegistry.id,
    hasDataRegistry: [] as string[],
  }

  // create Data registries
  for (const resourceServer of Object.values(account.data)) {
    const dataRegistryId = uriForContained(resourceServer, true)
    const dataRegistry = await session.factory.crud.dataRegistry(dataRegistryId)
    await DataRegistry.createDataRegistry(dataRegistry, session.factory)
    registrySetData.hasDataRegistry.push(dataRegistry.id)
  }

  const registrySetId = uriForContained(account.auth)
  const registrySet = await session.factory.crud.registrySet(registrySetId, registrySetData)

  return registrySet
}

global.buildSession = async function buildSession(account: Account): Promise<AuthorizationAgent> {
  const stu = new SolidTestUtils(account)
  await stu.auth()
  return await AuthorizationAgent.build(
    account.webId,
    `https://auth.example/${account.shortName}`,
    account.registrySet,
    {
      fetch: stu.authFetch,
      randomUUID: global.cuid,
    }
  )
}

global.accounts = accounts

global.server = await createApp()
await global.server.start()

repl.start('-> ')
