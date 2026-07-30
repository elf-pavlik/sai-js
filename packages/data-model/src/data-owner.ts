import { type GrantData, ReadableDataRegistrationProxy, type BaseFactory } from '.'

export class DataOwner {
  issuedGrants: GrantData[] = []

  constructor(public iri: string, public factory?: BaseFactory) {}

  /**
   * @public
   * @param shapeTree URL of shape tree
   * @returns  Array of data registration proxies for that shape tree
   */
  selectRegistrations(shapeTree: string): ReadableDataRegistrationProxy[] {
    if (!this.factory) throw new Error('DataOwner requires factory to create proxies')
    return this.issuedGrants
      .filter((sourceGrant) => sourceGrant.registeredShapeTree === shapeTree)
      .map((grant) => new ReadableDataRegistrationProxy(grant, this.factory!))
  }
}
