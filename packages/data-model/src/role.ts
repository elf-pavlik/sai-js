import { frameNode, opt, selectNode, strs } from '@janeirodigital/interop-utils'
import { dataModelContext } from './context'

export type RoleId = {
  id: string
  type: string[]
}

export type RoleData = RoleId & {
  label: string
  members: string[]
}

const ROLE_TERMS = ['label', 'members'] as const

export async function fromJsonLd(doc: unknown, id: string): Promise<RoleData> {
  const node = await frameNode(doc, dataModelContext, id)
  const selected = selectNode(node, ROLE_TERMS)
  return {
    id: node.id ?? node['@id'],
    type: node.type ?? [],
    label: opt(selected, 'label'),
    members: strs(selected, 'members'),
  }
}
