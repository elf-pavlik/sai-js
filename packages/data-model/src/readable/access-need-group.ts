import { INTEROP } from '@janeirodigital/interop-utils'
import type { AuthorizationAgentFactory } from '..'
import { findInLanguage, loadDescriptions } from '../access-description-set'
import type { AccessNeedGroupDescriptionData } from '../access-description'
import type { ReadableAccessNeed } from './access-need'
import { ReadableResource } from './resource'

export class ReadableAccessNeedGroup extends ReadableResource {
  public descriptions: { [key: string]: AccessNeedGroupDescriptionData } = {}

  accessNeeds: ReadableAccessNeed[] = []

  constructor(
    public iri: string,
    public factory: AuthorizationAgentFactory,
    public descriptionLang?: string
  ) {
    super(iri, factory)
  }

  get hasAccessNeed(): string[] {
    return this.getObjectsArray(INTEROP.hasAccessNeed).map((object) => object.value)
  }

  get reliableDescriptionLanguages(): Set<string> {
    return this.accessNeeds.reduce(
      (acc, need) => {
        if (!acc) return need.reliableDescriptionLanguages
        return new Set([...acc].filter((lang) => need.reliableDescriptionLanguages.has(lang)))
      },
      null as Set<string> | null
    )
  }

  public async getDescription(
    descriptionLang: string
  ): Promise<AccessNeedGroupDescriptionData | undefined> {
    if (this.descriptions[descriptionLang]) return this.descriptions[descriptionLang]
    const descriptionSetIri = findInLanguage(this.dataset, descriptionLang)
    if (!descriptionSetIri) return undefined
    const descriptionSet = await this.factory.readable.accessDescriptionSet(descriptionSetIri)
    const { accessNeedGroupDescriptions } = await loadDescriptions(descriptionSet, this.factory)
    return accessNeedGroupDescriptions.find(
      (description) => description.hasAccessNeedGroup === this.iri
    )
  }

  protected async bootstrap(): Promise<void> {
    await this.fetchData()
    this.accessNeeds = await Promise.all(
      this.hasAccessNeed.map((iri) => this.factory.readable.accessNeed(iri, this.descriptionLang))
    )
    if (this.descriptionLang) {
      const description = await this.getDescription(this.descriptionLang)
      if (description) {
        this.descriptions[this.descriptionLang] = description
      }
    }
  }

  public static async build(
    iri: string,
    factory: AuthorizationAgentFactory,
    descriptionLang?: string
  ): Promise<ReadableAccessNeedGroup> {
    const instance = new ReadableAccessNeedGroup(iri, factory, descriptionLang)
    await instance.bootstrap()
    return instance
  }
}
