export default {
  id: '@id',
  type: '@type',

  grantee: { '@id': 'http://www.w3.org/ns/solid/interop#grantee', '@type': '@id' },
  grantedBy: { '@id': 'http://www.w3.org/ns/solid/interop#grantedBy', '@type': '@id' },
  dataOwner: { '@id': 'http://www.w3.org/ns/solid/interop#dataOwner', '@type': '@id' },
  registeredShapeTree: { '@id': 'http://www.w3.org/ns/solid/interop#registeredShapeTree', '@type': '@id' },
  scopeOfAuthorization: { '@id': 'http://www.w3.org/ns/solid/interop#scopeOfAuthorization', '@type': '@id' },
  hasDataRegistration: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataRegistration', '@type': '@id' },
  satisfiesAccessNeed: { '@id': 'http://www.w3.org/ns/solid/interop#satisfiesAccessNeed', '@type': '@id' },
  inheritsFromAuthorization: { '@id': 'http://www.w3.org/ns/solid/interop#inheritsFromAuthorization', '@type': '@id' },

  accessMode: { '@id': 'http://www.w3.org/ns/solid/interop#accessMode', '@type': '@id', '@container': '@set' },
  creatorAccessMode: { '@id': 'http://www.w3.org/ns/solid/interop#creatorAccessMode', '@type': '@id', '@container': '@set' },
  hasDataInstance: { '@id': 'http://www.w3.org/ns/solid/interop#hasDataInstance', '@type': '@id', '@container': '@set' },

  hasInheritingAuthorization: {
    '@reverse': 'http://www.w3.org/ns/solid/interop#inheritsFromAuthorization',
    '@container': '@set',
    '@type': '@id',
  },
}
