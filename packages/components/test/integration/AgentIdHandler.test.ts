import type { KeyPair } from '@inrupt/solid-client-authn-core'
import {
  buildAuthenticatedFetch,
  createDpopHeader,
  generateDpopKeyPair,
} from '@inrupt/solid-client-authn-core'
import { getAgentRegistrationIri } from '@janeirodigital/interop-utils'
import { APPLICATION_X_WWW_FORM_URLENCODED, joinFilePath, joinUrl } from '@solid/community-server'
import type { App } from '@solid/community-server'
import type { IModuleState } from 'componentsjs'
import { ComponentsManager } from 'componentsjs'
import { parse, splitCookiesString } from 'set-cookie-parser'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const port = 6300
const baseUrl = `http://localhost:${port}/`
const pathPrefix = '.sai/agents/'

const rootFilePath = '/tmp/AgentIdHandler'

describe.skip('AgentIdHandler', (): void => {
  let app: App
  const indexUrl = joinUrl(baseUrl, '.account/')
  const vaporWebId = 'http://localhost:3711/vaporcg/profile/card#me'
  const lukaWebId = 'http://localhost:3711/luka/profile/card#me'
  const clientId = 'http://localhost:3711/solid/inspector/id'
  const encodedVaporWebId = Buffer.from(vaporWebId).toString('base64url')
  const encodedLukaWebId = Buffer.from(lukaWebId).toString('base64url')
  const email = 'test@example.com'
  const password = 'password!'
  let controls: {
    oidc: { webId: string; consent: string; forgetWebId: string; prompt: string }
    main: { index: string }
    account: { create: string; pod: string; logout: string }
    password: { create: string; login: string }
  }

  beforeAll(async (): Promise<void> => {
    const variables = {
      ...getDefaultVariables(port, baseUrl),
      'urn:solid-server:default:variable:rootFilePath': rootFilePath,
    }

    // Create and start the server
    const instances = (await instantiateFromConfig(
      'urn:solid-server:test:Instances',
      [getTestConfigPath('auth.json')],
      variables
    )) as Record<string, any>
    ;({ app } = instances)

    await app.start()

    // create accounts
    const regResult = await register(baseUrl, { email, password, webId: vaporWebId })
    ;({ controls } = regResult)
  })

  afterAll(async (): Promise<void> => {
    await app.stop()
  })

  test('responds with ClientId Document', async (): Promise<void> => {
    const url = `${baseUrl}${pathPrefix}${encodedLukaWebId}`
    const response = await fetch(url)
    const doc = await response.json()
    expect(response.status).toBe(200)
    expect(doc.credentials).toBeDefined()
  })

  describe('using client_credentials', (): void => {
    const tokenUrl = joinUrl(baseUrl, '.oidc/token')
    let dpopKey: KeyPair
    let id: string | undefined
    let secret: string | undefined
    let accessToken: string | undefined

    beforeAll(async (): Promise<void> => {
      dpopKey = await generateDpopKeyPair()
    })

    test('can request a credentials token.', async (): Promise<void> => {
      // Login and save cookie
      const loginResponse = await fetch(controls.password.login, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const cookies = parse(splitCookiesString(loginResponse.headers.get('set-cookie')!))
      const cookie = `${cookies[0].name}=${cookies[0].value}`

      // Request token
      const accountJson = await (await fetch(indexUrl, { headers: { cookie } })).json()
      const credentialsUrl = accountJson.controls.account.clientCredentials
      const res = await fetch(credentialsUrl, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: clientId, webId: vaporWebId }),
      })

      const payload = await res.json()
      expect(res.status).toBe(200)
      ;({ id, secret } = payload)
    })

    test('can request an access token using the credentials.', async (): Promise<void> => {
      const dpopHeader = await createDpopHeader(tokenUrl, 'POST', dpopKey)
      const authString = `${encodeURIComponent(id!)}:${encodeURIComponent(secret!)}`
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(authString).toString('base64')}`,
          'content-type': APPLICATION_X_WWW_FORM_URLENCODED,
          dpop: dpopHeader,
        },
        body: 'grant_type=client_credentials&scope=webid',
      })
      expect(res.status).toBe(200)
      const json = await res.json()
      ;({ access_token: accessToken } = json)
      expect(typeof accessToken).toBe('string')
    })

    test('responds with social agent registry in headers', async (): Promise<void> => {
      const authFetch = buildAuthenticatedFetch(accessToken!, { dpopKey })
      const url = `${baseUrl}${pathPrefix}${encodedLukaWebId}`
      const response = await authFetch(url)
      const doc = await response.json()
      expect(response.status).toBe(200)
      expect(doc.credentials.agent.webId).toBe(vaporWebId)
      expect(getAgentRegistrationIri(response.headers.get('Link')!)).toBe(
        'http://localhost:3711/luka/fypm7e/ewyjet/'
      )
    })

    test('responds with application registry in headers', async (): Promise<void> => {
      const authFetch = buildAuthenticatedFetch(accessToken!, { dpopKey })
      const url = `${baseUrl}${pathPrefix}${encodedVaporWebId}`
      const response = await authFetch(url)
      const doc = await response.json()
      expect(response.status).toBe(200)
      expect(doc.credentials.agent.webId).toBe(vaporWebId)
      expect(getAgentRegistrationIri(response.headers.get('Link')!)).toBe(
        'http://localhost:3711/vaporcg/khp4oz/r8fr2c/'
      )
    })

    test.todo('responds with no Link if no registry was found')
  })
})

// all below yanked from CSS

function getTestConfigPath(configFile: string): string {
  return joinFilePath(__dirname, 'config', configFile)
}

function getDefaultVariables(port: number, baseUrl?: string): Record<string, any> {
  return {
    'urn:solid-server:default:variable:baseUrl': baseUrl ?? `http://localhost:${port}/`,
    'urn:solid-server:default:variable:port': port,
    'urn:solid-server:default:variable:socket': null,
    'urn:solid-server:default:variable:loggingLevel': 'off',
    'urn:solid-server:default:variable:showStackTrace': true,
    'urn:solid-server:default:variable:seedConfig': null,
    'urn:solid-server:default:variable:workers': 1,
    'urn:solid-server:default:variable:confirmMigration': false,
  }
}

let cachedModuleState: IModuleState
/**
 * Returns a component instantiated from a Components.js configuration.
 */
async function instantiateFromConfig(
  componentUrl: string,
  configPaths: string | string[],
  variables?: Record<string, any>
): Promise<any> {
  // Initialize the Components.js loader
  const mainModulePath = joinFilePath(__dirname, '../../')
  const manager = await ComponentsManager.build({
    mainModulePath,
    logLevel: 'error',
    moduleState: cachedModuleState,
    typeChecking: false,
  })
  cachedModuleState = manager.moduleState

  const paths = Array.isArray(configPaths) ? configPaths : [configPaths]

  // Instantiate the component from the config(s)
  for (const configPath of paths) {
    await manager.configRegistry.register(configPath)
  }
  return manager.instantiate(componentUrl, { variables })
}

type User = {
  email: string
  password: string
  webId: string
}

/**
 * Registers an account for the given user details and creates one or more pods.
 *
 * @param baseUrl - Base URL of the server.
 * @param user - User details to register.
 */
async function register(
  baseUrl: string,
  user: User
): Promise<{ webId: string; authorization: string; controls: any }> {
  // Get controls
  let res = await fetch(joinUrl(baseUrl, '.account/'))
  let { controls } = await res.json()

  // Create account
  res = await fetch(controls.account.create, { method: 'POST' })
  expect(res.status).toBe(200)
  const authorization = `CSS-Account-Token ${(await res.json()).authorization}`

  // Get account controls
  res = await fetch(controls.account.create, {
    headers: { authorization },
  })
  if (res.status !== 200) {
    throw new Error(`Error creating account: ${await res.text()}`)
  }
  const json = await res.json()
  ;({ controls } = json)

  // Add login method
  res = await fetch(controls.password.create, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
    }),
  })
  if (res.status !== 200) {
    throw new Error(`Error adding login method: ${await res.text()}`)
  }
  res = await fetch(controls.account.webId, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ webId: user.webId }),
  })

  return { ...(await res.json()), controls, authorization }
}
