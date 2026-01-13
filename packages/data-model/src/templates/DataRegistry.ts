interface DataRegistryData {
  id: string
}

export const dataRegistryTemplate = ({ id }: DataRegistryData): string => `
  PREFIX interop: <http://www.w3.org/ns/solid/interop#>
  PREFIX ldp: <http://www.w3.org/ns/ldp#>
  PREFIX space: <http://www.w3.org/ns/pim/space#>

  GRAPH <meta:${id}> {
    <${id}>
      a interop:DataRegistry, ldp:Resource, space:Storage .
  }
`
