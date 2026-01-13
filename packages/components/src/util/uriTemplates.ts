export function agentId(webId: string): string {
  return `${process.env.CSS_BASE_URL}.sai/agents/${Buffer.from(webId).toString('base64url')}`
}
