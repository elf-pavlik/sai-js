export default {
  '@context': {
    id: '@id',
    type: '@type',

    grantee: { '@id': 'http://www.w3.org/ns/solid/interop#grantee', '@type': '@id' },
    grantedBy: { '@id': 'http://www.w3.org/ns/solid/interop#grantedBy', '@type': '@id' },
    dataOwner: { '@id': 'http://www.w3.org/ns/solid/interop#dataOwner', '@type': '@id' },
    registeredShapeTree: { '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree', '@type': '@id' },
    hasDataRegistration: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataRegistration', '@type': '@id' },
    hasStorage: { '@id': 'http://www.w3.org/ns/solid/interop#hasStorage', '@type': '@id' },
    scopeOfGrant: { '@id': 'http://www.w3.org/ns/solid/interop#scopeOfGrant', '@type': '@id' },

    accessMode: { '@id': 'http://www.w3.org/ns/solid/interop#accessMode', '@type': '@id', '@container': '@set' },
    creatorAccessMode: { '@id': 'http://www.w3.org/ns/solid/interop#creatorAccessMode', '@type': '@id', '@container': '@set' },
    hasDataInstance: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataInstance', '@type': '@id', '@container': '@set' },

    inheritsFromGrant: { '@id': 'http://www.w3.org/ns/solid/interop#inheritsFromGrant', '@type': '@id' },
    delegationOfGrant: { '@id': 'http://www.w3.org/ns/solid/interop#delegationOfGrant', '@type': '@id' },

    hasInheritingGrant: {
      '@reverse': 'http://www.w3.org/ns/solid/interop#inheritsFromGrant',
      '@container': '@set',
    },
  },
}
