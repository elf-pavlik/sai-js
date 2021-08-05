// eslint-disable-next-line import/no-extraneous-dependencies
import { fetch } from '@janeirodigital/interop-test-utils';
import { parseTurtle } from '@janeirodigital/interop-utils';
import { randomUUID } from 'crypto';
import { ApplicationRegistration, InteropFactory } from '../src';

describe('constructor', () => {
  it('should set fetch', () => {
    const factory = new InteropFactory({ fetch, randomUUID });
    expect(factory.fetch).toBe(fetch);
  });
});

test('builds application registration', async () => {
  const factory = new InteropFactory({ fetch, randomUUID });
  const applicationRegistrationUrl = 'https://auth.alice.example/bcf22534-0187-4ae4-b88f-fe0f9fa96659';
  const applicationRegistration = await factory.applicationRegistration(applicationRegistrationUrl);
  expect(applicationRegistration).toBeInstanceOf(ApplicationRegistration);
});

test('throws for grant with invalid scope', async () => {
  const invalidGrantDataset = await parseTurtle(`
    PREFIX interop: <http://www.w3.org/ns/solid/interop#>
    PREFIX foo: <https://foo.example/>
    foo:bar interop:scopOfGrant interop:NonExistingScope .
  `);
  const fakeFetch = () => Promise.resolve({ dataset: invalidGrantDataset, ok: true });
  const factory = new InteropFactory({ fetch: fakeFetch, randomUUID });
  await expect(async () => await factory.dataGrant('http://some.iri')).rejects.toThrowError();
});
