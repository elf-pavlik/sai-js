<template>
  <v-container>
    <v-card>
      <v-card-title v-if="action === 'view'">
        {{ existingRole?.label }}
      </v-card-title>
      <v-card-title v-else>
        {{ action === 'create' ? $t('new-role') : $t('edit-role') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-if="action !== 'view'"
          v-model="label"
          v-bind="$ta('role-label')"
        />
        <v-list v-if="action === 'view' && existingRole">
          <v-list-item
            v-for="member in existingRole.members"
            :key="member"
          >
            <template #title>
              {{ agentLabel(member) }}
            </template>
          </v-list-item>
        </v-list>
        <v-list v-else-if="action !== 'view'">
          <v-list-item
            v-for="member in members"
            :key="member"
          >
            <template #title>
              <span :class="{ 'text-decoration-line-through text-disabled': markedForDelete.has(member) }">
                {{ agentLabel(member) }}
              </span>
            </template>
            <template
              v-if="action === 'edit'"
              #append
            >
              <v-btn
                v-if="markedForDelete.has(member)"
                icon="mdi-plus"
                size="small"
                variant="text"
                @click="markedForDelete.delete(member)"
              />
              <v-btn
                v-else
                icon="mdi-minus"
                size="small"
                variant="text"
                @click="markedForDelete.add(member)"
              />
            </template>
          </v-list-item>
          <v-list-item
            v-for="member in newMembers"
            :key="member"
          >
            <template #title>
              <span class="text-decoration-underline">
                {{ agentLabel(member) }}
              </span>
            </template>
            <template
              v-if="action !== 'view'"
              #append
            >
              <v-btn
                icon="mdi-minus"
                size="small"
                variant="text"
                @click="newMembers.delete(member)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <template v-if="action === 'view'">
          <v-btn
            prepend-icon="mdi-pencil"
            @click="router.push({name: 'role', query: {roleId: roleId, action: 'edit'}})"
          >
            {{ $t('edit') }}
          </v-btn>
          <v-btn
            prepend-icon="mdi-delete"
            color="error"
            @click="confirmDelete = true"
          >
            {{ $t('delete') }}
          </v-btn>
        </template>
        <template v-else>
          <v-btn
            variant="tonal"
            @click="router.back()"
          >
            {{ $t('cancel') }}
          </v-btn>
          <v-spacer />
          <v-btn
            color="primary"
            :disabled="!label || !dirty"
            @click="save"
          >
            {{ $t('save') }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
    <v-card
      v-if="action !== 'view'"
      class="mt-4"
    >
      <v-card-title>{{ $t('add-members') }}</v-card-title>
      <v-card-text>
        <v-list>
          <v-list-item
            v-for="agent in availableAgents"
            :key="agent.id"
          >
            <template #title>
              {{ agent.label }}
            </template>
            <template #append>
              <v-btn
                icon="mdi-plus"
                size="small"
                variant="text"
                @click="newMembers.add(agent.id)"
              />
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>
    <v-dialog v-model="confirmDelete">
      <v-card>
        <v-card-title>{{ $t('delete-role') }}</v-card-title>
        <v-card-text>
          <p>{{ $t('delete-role-confirm') }}</p>
          <v-text-field
            v-model="confirmLabel"
            v-bind="$ta('role-label')"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn @click="confirmDelete = false">{{ $t('cancel') }}</v-btn>
          <v-spacer />
          <v-btn
            color="error"
            :disabled="confirmLabel !== label"
            @click="remove"
          >
            {{ $t('delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
<script lang="ts" setup>
import { useAppStore } from '@/store/app'
import { IRI } from '@janeirodigital/sai-api-messages'
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const appStore = useAppStore()
appStore.listSocialAgents()
const router = useRouter()
const route = useRoute()

const action = computed(() => route.query.action as string)
const roleId = computed(() => route.query.roleId as string | undefined)

const existingRole = computed(() => appStore.roleList.find((r) => r.id === roleId.value))

const originalLabel = existingRole.value?.label ?? ''
const originalMembers = new Set(existingRole.value?.members ?? [])
const label = ref(originalLabel)
const members = computed(() => existingRole.value?.members ?? [])
const markedForDelete = reactive(new Set<IRI>())
const newMembers = reactive(new Set<IRI>())
const confirmDelete = ref(false)
const confirmLabel = ref('')

const availableAgents = computed(() =>
  appStore.socialAgentList.filter(
    (agent) => !originalMembers.has(agent.id) && !newMembers.has(agent.id)
  )
)

const dirty = computed(() => {
  if (label.value !== originalLabel) return true
  if (markedForDelete.size > 0) return true
  if (newMembers.size > 0) return true
  return false
})

function agentLabel(webId: string): string {
  const agent = appStore.socialAgentList.find((a) => a.id === webId)
  return agent?.label ?? webId
}

async function save() {
  const finalMembers: IRI[] = [
    ...members.value.filter((m) => !markedForDelete.has(m)),
    ...newMembers,
  ]
  if (action.value === 'create') {
    await appStore.createRole(label.value, finalMembers)
  } else if (action.value === 'edit') {
    await appStore.updateRole(IRI.make(roleId.value!), label.value, finalMembers)
    markedForDelete.clear()
    newMembers.clear()
  }
  router.back()
}

async function remove() {
  confirmDelete.value = false
  confirmLabel.value = ''
  await appStore.deleteRole(IRI.make(roleId.value!))
  router.back()
}
</script>
