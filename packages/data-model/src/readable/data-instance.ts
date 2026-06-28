import { SHAPETREES, buildNamespace, getDescriptionResource } from '@janeirodigital/interop-utils'
import type { InteropFactory, ReadableDataRegistration, ReadableShapeTree } from '..'
import { ReadableResource } from './resource'

interface ChildInfo {
  shapeTree: {
    iri: string
    label: string
  }
  count: number
}

export class ReadableDataInstance extends ReadableResource {
  dataRegistration?: ReadableDataRegistration

  children: ChildInfo[]

  private _shapeTree?: ReadableShapeTree

  constructor(
    public iri: string,
    public factory: InteropFactory,
    public shapeTreeIri?: string,
    public descriptionLang?: string
  ) {
    super(iri, factory)
  }

  private async bootstrap(): Promise<void> {
    if (this.shapeTreeIri) {
      this._shapeTree = await this.factory.readable.shapeTree(this.shapeTreeIri, this.descriptionLang)
    } else {
      await this.buildDataRegistration()
    }
    if (!this.isBlob) {
      await this.fetchData()
    } else {
      const descriptionIri = await this.discoverDescriptionResource()
      const response = await this.fetch(descriptionIri)
      this.dataset = await response.dataset()
    }

    if (this.descriptionLang) {
      await (this._shapeTree ?? this.dataRegistration?.shapeTree)?.getDescription(this.descriptionLang)
      this.children = await this.buildChildrenInfo()
    }
  }

  private async buildDataRegistration() {
    const dataRegistrationIri = `${this.iri.split('/').slice(0, -1).join('/')}/`
    this.dataRegistration = await this.factory.readable.dataRegistration(dataRegistrationIri)
  }

  public static async build(
    iri: string,
    factory: InteropFactory,
    shapeTreeIri?: string,
    descriptionLang?: string
  ): Promise<ReadableDataInstance> {
    const instance = new ReadableDataInstance(iri, factory, shapeTreeIri, descriptionLang)
    await instance.bootstrap()
    return instance
  }

  get label(): string | undefined {
    let label
    const shapeTree = this._shapeTree ?? this.dataRegistration?.shapeTree
    const predicate = shapeTree?.describesInstance
    if (predicate) {
      label = this.getObject(predicate)?.value
    }
    const NFO = buildNamespace('http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#')
    return label || this.getObject(NFO.fileName)?.value
  }

  get shapeTree(): { iri: string; label: string } {
    const shapeTree = this._shapeTree ?? this.dataRegistration!.shapeTree!
    return {
      iri: shapeTree.iri,
      label: shapeTree.descriptions[this.descriptionLang]!.label,
    }
  }

  // TODO: extract as mixin from other data instance
  get isBlob(): boolean {
    const shapeTree = this._shapeTree ?? this.dataRegistration?.shapeTree
    return shapeTree?.expectsType.value === SHAPETREES.NonRDFResource.value
  }

  async buildChildrenInfo(): Promise<ChildInfo[]> {
    const shapeTree = this._shapeTree ?? this.dataRegistration!.shapeTree!
    return Promise.all(
      shapeTree.references.map(async (reference) => {
        const childTree = await this.factory.readable.shapeTree(
          reference.shapeTree,
          this.descriptionLang
        )
        return {
          count: this.getObjectsArray(reference.viaPredicate).length,
          shapeTree: {
            iri: reference.shapeTree,
            label: childTree.descriptions[this.descriptionLang]!.label,
          },
        }
      })
    )
  }

  // TODO: extract as mixin from container
  async discoverDescriptionResource(): Promise<string> {
    // @ts-ignore
    const response = await this.fetch.raw(this.iri, {
      method: 'HEAD',
    })

    // get value of describedby Link
    return getDescriptionResource(response.headers.get('Link'))
  }
}
