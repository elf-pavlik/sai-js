// Utilities
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { Agent, FileInstance, ImageInstance, Project, Registration, Task } from '@/models';;
import { useCoreStore } from './core';
import { toSparqlUpdate, LdoBase, startTransaction, commitTransaction, write, createLdoDataset } from '@ldo/ldo';
import { Task as LdoTask } from '../../ldo/Task$.typings';
import { DataInstance } from '@janeirodigital/interop-data-model';

import { getDefaultSession } from '@inrupt/solid-client-authn-browser';
import { Application, SaiEvent } from '@janeirodigital/interop-application';
import { ACL, RequestError, buildNamespace } from '@janeirodigital/interop-utils';
import { ProjectShapeType } from '../../ldo/Project$.shapeTypes';
import { TaskShapeType } from '../../ldo/Task$.shapeTypes';

const cache: { [key: string]: DataInstance } = {};
const ownerIndex: { [key: string]: string } = {};

const NFO = buildNamespace('http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#');
const AWOL = buildNamespace('http://bblfish.net/work/atom-owl/2006-06-06/#');

const shapeTrees = {
  project: 'http://localhost:3000/shapetrees/trees/Project',
  task: 'http://localhost:3000/shapetrees/trees/Task',
  image: 'http://localhost:3000/shapetrees/trees/Image',
  file: 'http://localhost:3000/shapetrees/trees/File'
};

type RegistrationId = string;
type AgentId = string;
type ProjectId = string;

export const useAppStore = defineStore('app', () => {
  const coreStore = useCoreStore();
  const agents = ref<Agent[]>([]);
  const dataInstances = ref<Record<string, DataInstance>>({});
  const projects = ref<Record<RegistrationId, Project[]>>({});
  const registrations = ref<Record<AgentId, Registration[]>>({});
  const tasks = ref<Record<ProjectId, Task[]>>({});
  const files = ref<FileInstance[]>([]);
  const images = ref<ImageInstance[]>([]);
  const currentAgent = ref<Agent>();
  const currentProject = ref<Project>();
  const isAuthorized = ref(false);
  const saiError = ref<string | undefined>();

  async function loadAgents(force = false): Promise<void> {
    if (force || !agents.value.length) {
      agents.value = await getAgents();
    }
  }

  // DO NOT AWAIT! (infinite loop)
  async function watchSai(): Promise<void> {
    const stream = await getStream();
    if (stream.locked) return;
    const reader = stream.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.type === 'GRANT') loadAgents(true);
    }
  }

  async function loadProjects(ownerId: string): Promise<void> {
    if (registrations.value[ownerId]) return;
    
    const session = await ensureSaiSession();
    const user = session.dataOwners.find((agent) => agent.iri === ownerId);
    if (!user) {
      throw new Error(`data registration not found for ${ownerId}`);
    }
    const ownerProjects: Record<string, Project[]> = {};
    const ownerRegistration: Record<string, Registration[]> = {};
    ownerRegistration[ownerId] = [];
    for (const registration of user.selectRegistrations(shapeTrees.project)) {
      ownerRegistration[ownerId].push({
        id: registration.iri,
        label: 'TODO',
        owner: ownerId,
        canCreate: registration.grant.accessMode.includes(ACL.Create.value)
      });
      ownerProjects[registration.iri] = [];
      // eslint-disable-next-line no-await-in-loop
      for await (const dataInstance of registration.dataInstances) {
        cache[dataInstance.iri] = dataInstance;
        ownerIndex[dataInstance.iri] = ownerId;
        ownerProjects[registration.iri].push(instance2Project(dataInstance, ownerId, registration.iri));
      }
    }

    projects.value = { ...projects.value, ...ownerProjects };
    registrations.value = { ...registrations.value, ...ownerRegistration };
  }

  async function loadTasks(projectId: string): Promise<void> {
    await ensureSaiSession();
    const project = cache[projectId];
    if (!project) {
      throw new Error(`Project not found for: ${projectId}`);
    }
    const projectTasks = [];
    for await (const dataInstance of project.getChildInstancesIterator(shapeTrees.task)) {
      cache[dataInstance.iri] = dataInstance;
      const ldoDataset = createLdoDataset([...dataInstance.dataset]);
      const ldoTask = ldoDataset.usingType(TaskShapeType).fromSubject(dataInstance.iri);
      projectTasks.push(instance2Task(ldoTask, dataInstance, projectId, ownerIndex[projectId]));
    }

    tasks.value[projectId] = projectTasks
  }

  async function updateTask(task: Task) {
    await ensureSaiSession();
    const project = cache[task.project];
    if (!project) {
      throw new Error(`project not found ${task.project}`);
    }
    let instance: DataInstance;
    if (task.id !== 'DRAFT') {
      const cached = cache[task.id];
      if (!cached) {
        throw new Error(`Data Instance not found for: ${task.id}`);
      }
      instance = cached;
    } else {
      instance = await project.newChildDataInstance(shapeTrees.task);
      cache[instance.iri] = instance;
    }
    
    try {
      commitTransaction(task.data);
      await updateLdo(task.data);
    } catch (error) {
      console.error('error updating task', error);
    }

    const updated = instance2Task(task.data, instance, project.iri, ownerIndex[project.iri]);

    if (task.id === 'DRAFT') {
      tasks.value[task.project].push(updated);
    } else {
      const indexToUpdate = tasks.value[task.project].findIndex((t) => t.id === task.id);
      if (indexToUpdate === -1) {
        throw new Error(`task not found: ${task.id}`);
      }
      tasks.value[task.project][indexToUpdate] = updated;
    }
  }

  async function deleteTask(task: Task) {
    await ensureSaiSession();
    const toDelete = tasks.value[task.project].find((t) => t.id === task.id);
    if (!toDelete) {
      throw new Error(`task not found: ${task.id}`);
    }
    tasks.value[task.project].splice(tasks.value[task.project].indexOf(toDelete), 1);

    const instance = cache[task.id];
    await instance.delete();
    delete cache[task.id];
  }

  async function loadFiles(projectId: string): Promise<void> {
    const data = await getFiles(projectId);
    files.value = data.files;
  }

  async function updateFile(file: FileInstance, blob?: File) {
    await ensureSaiSession();
    let instance: DataInstance;
    if (file.id !== 'DRAFT') {
      const cached = cache[file.id];
      if (!cached) {
        throw new Error(`Data Instance not found for: ${file.id}`);
      }
      instance = cached;
    } else {
      if (!blob) {
        throw new Error(`image file missing`);
      }
      const project = cache[file.project];
      if (!project) {
        throw new Error(`project not found ${file.project}`);
      }
  
      instance = await project.newChildDataInstance(shapeTrees.file);
      instance.replaceValue(NFO.fileName, blob.name);
      instance.replaceValue(AWOL.type, blob.type);
      cache[instance.iri] = instance;
    }
  
    const updated = instance2File(instance, file.project, file.owner);

    if (file.id === 'DRAFT') {
      files.value.push(updated);
    } else {
      const toUpdate = files.value.find((t) => t.id === file.id);
      if (!toUpdate) {
        throw new Error(`task not found: ${file.id}`);
      }
      toUpdate.filename = updated.filename;
    }
    update(updated.id, blob);
  }

  async function loadImages(projectId: string): Promise<void> {
    const data = await getImages(projectId);
    images.value = data.images;
  }

  function setCurrentAgent(agentId: string) {
    currentAgent.value = agents.value.find((a) => a.id === agentId);
  }

  function setCurrentProject(registrationId: string, projectId: string) {
    currentProject.value = projects.value[registrationId]?.find((p) => p.id === projectId);
  }

  async function shareProject(projectId: string) {
    share(projectId);
  }


  function changeData<Type extends LdoBase>(input: Type): Type {
    const [transactionLdo] = write(input['@id']).usingCopy(
      input,
    );
    startTransaction(transactionLdo);
    return transactionLdo;
  }


function instance2Project(instance: DataInstance, owner: string, registration: string): Project {
  const ldoDataset = createLdoDataset([...instance.dataset]);
  const ldoProject = ldoDataset.usingType(ProjectShapeType).fromSubject(instance.iri);
  return {
    id: instance.iri,
    label: ldoProject.label,
    owner,
    registration,
    canUpdate: instance.accessMode.includes(ACL.Update.value),
    canAddTasks: instance.findChildGrant(shapeTrees.task)?.accessMode.includes(ACL.Create.value),
    canAddImages: instance.findChildGrant(shapeTrees.image)?.accessMode.includes(ACL.Create.value),
    canAddFiles: instance.findChildGrant(shapeTrees.file)?.accessMode.includes(ACL.Create.value)
  };
}

function instance2Task(task: LdoTask, instance: DataInstance, project: string, owner: string): Task {
  return {
    id: instance.iri,
    data: task,
    project,
    owner,
    canUpdate: instance.accessMode.includes(ACL.Update.value),
    canDelete: instance.accessMode.includes(ACL.Delete.value)
  };
}

function instance2File(instance: DataInstance, project: string, owner: string): FileInstance {
  return {
    id: instance.iri,
    filename: instance.getObject(NFO.fileName)?.value,
    project,
    owner,
    canUpdate: instance.accessMode.includes(ACL.Update.value),
    canDelete: instance.accessMode.includes(ACL.Delete.value)
  };
}

function getAccessModes(task: Task) {
  const project = cache[task.project];
  if (!project) {
    throw new Error(`Project not found for: ${task.project}`);
  }

  const dataGrant = project.findChildGrant(shapeTrees.task);
  return {
    canUpdate: dataGrant.accessMode.includes(ACL.Update.value),
    canDelete: dataGrant.accessMode.includes(ACL.Delete.value)
  };
}

async function authorize() {
  if (!coreStore.userId) {
    throw new Error('no user id');
  }
  window.location.href = await getAuthorizationRedirectUri();
}

watch(() => coreStore.userId, async (userId) => {
  if (!userId) return;
  try {
    isAuthorized.value = await checkAuthoriztion();
  } catch (err) {
    if (err instanceof RequestError) {
      saiError.value = err.message;
      if (err.response) console.error(err.response);
    }
  }
});

let saiSession: Application | undefined;

const authnFetch = getDefaultSession().fetch;

async function ensureSaiSession(): Promise<Application> {
  if (!coreStore.userId) {
    throw new Error('no user id');
  }
  if (saiSession) return saiSession;
  const deps = { fetch: authnFetch, randomUUID: crypto.randomUUID.bind(crypto) };
  saiSession = await Application.build(coreStore.userId, import.meta.env.VITE_APPLICATION_ID, deps);
  return saiSession;
}

async function getStream(): Promise<ReadableStream<SaiEvent>> {
  const session = await ensureSaiSession();
  return session.stream;
}

async function checkAuthoriztion(): Promise<boolean> {
  const session = await ensureSaiSession();
  return !!session.hasApplicationRegistration?.hasAccessGrant.granted;
}

async function getAuthorizationRedirectUri(): Promise<string> {
  const session = await ensureSaiSession();
  return session.authorizationRedirectUri;
}

async function share(resourceId: string) {
  const session = await ensureSaiSession();
  const shareUri = session.getShareUri(resourceId);
  if (!shareUri) throw new Error('shareUri is undefined');
  window.localStorage.setItem('restorePath', `${window.location.pathname}${window.location.search}`);
  window.location.href = shareUri;
}

async function getAgents(): Promise<Agent[]> {
  const session = await ensureSaiSession();

  const profiles = await Promise.all(
    session.dataOwners.map((owner) => session.factory.readable.webIdProfile(owner.iri))
  );

  return profiles.map((profile) => ({
    id: profile.iri,
    label: profile.label ?? 'unknown' // TODO think of a better fallback
  }));
}

async function getTasks(projectId: string): Promise<{ projectId: string; tasks: Task[] }> {
  await ensureSaiSession();
  const project = cache[projectId];
  if (!project) {
    throw new Error(`Project not found for: ${projectId}`);
  }
  const tasks = [];
  for await (const dataInstance of project.getChildInstancesIterator(shapeTrees.task)) {
    cache[dataInstance.iri] = dataInstance;
    const ldoDataset = createLdoDataset([...dataInstance.dataset]);
    const ldoTask = ldoDataset.usingType(TaskShapeType).fromSubject(dataInstance.iri);
    tasks.push(instance2Task(ldoTask, dataInstance, projectId, ownerIndex[projectId]));
  }

  return { projectId, tasks };
}

async function updateLdo(ldo: LdoBase) {
  const { fetch: authFetch } = getDefaultSession();
  authFetch(ldo['@id'], {
    method: 'PATCH',
    body: await toSparqlUpdate(ldo),
    headers: {
      'Content-Type': 'application/sparql-update'
    }
  });
}

async function getFiles(projectId: string): Promise<{ projectId: string; files: FileInstance[] }> {
  await ensureSaiSession();
  const project = cache[projectId];
  if (!project) {
    throw new Error(`Project not found for: ${projectId}`);
  }
  const files = [];
  for await (const dataInstance of project.getChildInstancesIterator(shapeTrees.file)) {
    cache[dataInstance.iri] = dataInstance;
    files.push(instance2File(dataInstance, projectId, ownerIndex[projectId]));
  }

  return { projectId, files };
}

async function getImages(projectId: string): Promise<{ projectId: string; images: ImageInstance[] }> {
  await ensureSaiSession();
  const project = cache[projectId];
  if (!project) {
    throw new Error(`Project not found for: ${projectId}`);
  }
  const images = [];
  for await (const dataInstance of project.getChildInstancesIterator(shapeTrees.image)) {
    cache[dataInstance.iri] = dataInstance;
    images.push(instance2File(dataInstance, projectId, ownerIndex[projectId]));
  }

  return { projectId, images };
}

async function update(iri: string, blob?: File) {
  const instance = cache[iri];
  if (!instance) {
    throw new Error(`Instance not found for: ${iri}`);
  }
  return instance.update(instance.dataset, blob);
}

async function dataUrl(url: string): Promise<string> {
  const { fetch } = getDefaultSession();
  return fetch(url)
    .then((response) => response.blob())
    .then((blb) => URL.createObjectURL(blb));
}


  return {
    agents,
    currentAgent,
    currentProject,
    registrations,
    projects,
    tasks,
    files,
    images,
    setCurrentAgent,
    setCurrentProject,
    shareProject,
    watchSai,
    loadAgents,
    loadProjects,
    loadTasks,
    updateTask,
    deleteTask,
    loadFiles,
    updateFile,
    loadImages,
    changeData,
    authorize,
    getStream,
    isAuthorized,
    getAuthorizationRedirectUri,
    share,
    dataUrl,
    update
  };
});
