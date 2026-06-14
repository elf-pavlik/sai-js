<template>
  <v-sheet>
    <v-card
      v-for="role in appStore.roleList"
      :key="role.id"
      :title="role.label"
      @click="router.push({name: 'role', query: {roleId: role.id, action: 'view'}})"
    >
      <v-card-subtitle>
        <v-chip
          v-for="member in role.members"
          :key="member"
          size="small"
          class="mr-1"
        >
          {{ agentLabel(member) }}
        </v-chip>
      </v-card-subtitle>
    </v-card>
    <v-btn
      id="add"
      icon="mdi-plus-circle-outline"
      @click="router.push({name: 'role', query: {action: 'create'}})"
    />
  </v-sheet>
</template>
<script lang="ts" setup>
import { useAppStore } from '@/store/app'
import { useRouter } from 'vue-router'

const router = useRouter()
const appStore = useAppStore()
appStore.listRoles()
appStore.listSocialAgents()

function agentLabel(webId: string): string {
  const agent = appStore.socialAgentList.find((a) => a.id === webId)
  return agent?.label ?? webId
}
</script>

<style>
#add {
  position: absolute;
  bottom: 60px;
  left: calc(50% - 24px);
}
</style>
