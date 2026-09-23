export type AccessDescriptionId = {
  id: string
  type: string[]
}

export type AccessDescriptionData = AccessDescriptionId & {
  label: string
  definition?: string
}
