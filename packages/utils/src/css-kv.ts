export const cssKv = {
  accountData: (id: string) => `accounts/data/${id}`,
  webIdLink: (id: string) => `accounts/index/webIdLink/${id}`,
  webIdLinkByWebId: (webId: string) =>
    `accounts/index/webIdLink/webId/${encodeURIComponent(webId)}`,
  owner: (id: string) => `accounts/index/owner/${id}`,
  pod: (id: string) => `accounts/index/pod/${id}`,
  podByBaseUrl: (baseUrl: string) =>
    `accounts/index/pod/baseUrl/${encodeURIComponent(baseUrl)}`,
  password: (id: string) => `accounts/index/password/${id}`,
  passwordByEmail: (email: string) =>
    `accounts/index/password/email/${encodeURIComponent(email)}`,
  cookie: (id: string) => `accounts/cookies/${id}`,
}
