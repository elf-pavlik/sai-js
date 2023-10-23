import type { CRUDDataRegistry, DataGrant } from '@janeirodigital/interop-data-model';
import type { AuthorizationAgent } from '@janeirodigital/interop-authorization-agent';
import type { DataRegistration, DataRegistry } from '@janeirodigital/sai-api-messages';

const buildDataRegistry = async (
  registry: CRUDDataRegistry,
  descriptionsLang: string,
  saiSession: AuthorizationAgent
): Promise<DataRegistry> => {
  const registrations: DataRegistration[] = [];
  for await (const registration of registry.registrations) {
    const shapeTree = await saiSession.factory.readable.shapeTree(registration.registeredShapeTree, descriptionsLang);
    registrations.push({
      id: registration.iri,
      shapeTree: registration.registeredShapeTree,
      dataRegistry: registry.iri,
      count: registration.contains.length,
      label: shapeTree.descriptions[descriptionsLang]?.label
    });
  }
  return {
    id: registry.iri,
    registrations
  };
};

const buildDataRegistryForGrant = async (
  registryIri: string,
  dataGrants: DataGrant[],
  descriptionsLang: string,
  saiSession: AuthorizationAgent
): Promise<DataRegistry> => {
  const registrations: DataRegistration[] = [];
  for (const dataGrant of dataGrants) {
    // eslint-disable-next-line no-await-in-loop
    const shapeTree = await saiSession.factory.readable.shapeTree(dataGrant.registeredShapeTree, descriptionsLang);
    registrations.push({
      id: dataGrant.hasDataRegistration,
      shapeTree: dataGrant.registeredShapeTree,
      dataRegistry: registryIri,
      label: shapeTree.descriptions[descriptionsLang]?.label
    });
  }
  return {
    id: registryIri,
    registrations
  };
};

export const getDataRegistries = async (agentId: string, descriptionsLang: string, saiSession: AuthorizationAgent) => {
  if (agentId === saiSession.webId) {
    return Promise.all(
      saiSession.registrySet.hasDataRegistry.map((registry) =>
        buildDataRegistry(registry, descriptionsLang, saiSession)
      )
    );
  }
  const socialAgentRegistration = (await saiSession.findSocialAgentRegistration(agentId)).reciprocalRegistration;
  if (!socialAgentRegistration) {
    throw new Error(`missing social agent registration: ${agentId}`);
  }
  if (!socialAgentRegistration.accessGrant) {
    throw new Error(`missing access grant for social agent: ${agentId}`);
  }
  const dataGrantIndex = socialAgentRegistration.accessGrant.hasDataGrant.reduce((acc, dataGrant) => {
    if (!acc[dataGrant.dataRegistryIri]) {
      acc[dataGrant.dataRegistryIri] = [] as DataGrant[];
    }
    acc[dataGrant.dataRegistryIri].push(dataGrant);
    return acc;
  }, {} as Record<string, DataGrant[]>);
  return Promise.all(
    Object.entries(dataGrantIndex).map(([registryIri, dataGrants]) =>
      buildDataRegistryForGrant(registryIri, dataGrants, descriptionsLang, saiSession)
    )
  );
};
