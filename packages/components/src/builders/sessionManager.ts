import { EnvJwkGenerator } from '../EnvJwkGenerator.js'
import { SessionManager } from '../SessionManager.js'

export function buildSessionManager(): SessionManager {
  const jwkGenerator = new EnvJwkGenerator(process.env.CSS_ENCODED_PRIVATE_JWK)
  return new SessionManager(process.env.CSS_BASE_URL, jwkGenerator, 60)
}
