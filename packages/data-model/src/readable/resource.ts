import { DatasetCore } from '@rdfjs/types';
import { getStorageDescription, getUpdatesVia } from '@janeirodigital/interop-utils';
import { Resource } from '..';

export class ReadableResource extends Resource {
  public notifications?: string;

  protected async fetchData(): Promise<void> {
    const response = await this.fetch(this.iri);
    this.dataset = await response.dataset();
    this.notifications = getUpdatesVia(response.headers.get('Link'));
  }

  protected async fetchStorageDescription(): Promise<DatasetCore> {
    // @ts-ignore
    const response = await this.fetch.raw(this.iri, {
      method: 'HEAD'
    });
    const storageDescriptionIri = getStorageDescription(response.headers.get('Link'));
    return this.fetch(storageDescriptionIri).then((res) => res.dataset());
  }
}
