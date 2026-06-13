<template>
  <v-sheet>
    <v-card
      v-for="role in appStore.roleList"
      :key="role.id"
      :title="role.label"
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
  </v-sheet>
</template>
<script lang="ts" setup>
import { useAppStore } from '@/store/app'

const appStore = useAppStore()
appStore.listRoles()
appStore.listSocialAgents()

function agentLabel(webId: string): string {
  const agent = appStore.socialAgentList.find((a) => a.id === webId)
  return agent?.label ?? webId
}
</script>
