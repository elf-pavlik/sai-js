import { frameNode, selectNode } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type DataRegistrationId = {
  id: string
  type: string[]
}

export type DataRegistrationData = DataRegistrationId & {
  registeredShapeTree: string
  /** Resources contained in the registration (LDP containment, server-managed). */
  contains: string[]
}

const DATA_REGISTRATION_TERMS = ['registeredShapeTree', 'contains']

export async function fromJsonLd(doc: unknown, id: string): Promise<DataRegistrationData> {
  return selectNode(
    await frameNode(doc, dataModelContext, id),
    DATA_REGISTRATION_TERMS
  ) as unknown as DataRegistrationData
}
