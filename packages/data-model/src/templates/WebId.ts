// TODO: https://github.com/hackers4peace/sai-js/issues/91

interface WebIdData {
  id: string
  document: string
  issuer: string
  uas: string
  registry: string
}

export const webIdTemplate = ({ id, document, issuer, uas, registry }: WebIdData): string => `
  PREFIX solid: <http://www.w3.org/ns/solid/terms#>
  PREFIX interop: <http://www.w3.org/ns/solid/interop#>

  GRAPH <${document}> {
    <${id}>
        solid:oidcIssuer <${issuer}>;
        interop:hasRegistrySet <${registry}>;
        interop:hasAuthorizationAgent <${uas}> .
  }
`
