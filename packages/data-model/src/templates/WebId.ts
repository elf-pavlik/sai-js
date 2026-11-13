// TODO: https://github.com/hackers4peace/sai-js/issues/91

interface WebIdData {
  id: string
  document: string
  issuer: string
  uas: string
  /** legacy delegation-issuance endpoint, removed in the cleanup step */
  issuance: string
  accessRequests: string
  accessGrants: string
}

export const webIdTemplate = ({
  id,
  document,
  issuer,
  uas,
  issuance,
  accessRequests,
  accessGrants,
}: WebIdData): string => `
  PREFIX solid: <http://www.w3.org/ns/solid/terms#>
  PREFIX interop: <http://www.w3.org/ns/solid/interop#>
  PREFIX lws: <https://www.w3.org/ns/lws#>
  PREFIX did: <https://www.w3.org/ns/did#>

  GRAPH <${document}> {
    <${id}>
        solid:oidcIssuer <${issuer}>;
        interop:hasDelegationIssuanceEndpoint <${issuance}>;
        interop:hasAuthorizationAgent <${uas}>;
        did:service [
          a lws:AccessRequestService;
          did:serviceEndpoint <${accessRequests}>
        ], [
          a lws:AccessGrantService;
          did:serviceEndpoint <${accessGrants}>
        ] .
  }
`
