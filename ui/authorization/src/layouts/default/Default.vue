<template>
  <v-app>
    <v-app-bar
      v-if="coreStore.userId"
      elevation="0"
    >
      <v-app-bar-title @click="coreStore.navigateHome()">
        <v-icon icon="mdi-shield-account" />
        SAI
      </v-app-bar-title>
      <v-spacer />
      <!-- org-admin context switcher: personal context + each administered org -->
      <v-select
        v-model="currentContext"
        :items="contextItems"
        item-title="title"
        item-value="value"
        hide-details
        density="compact"
        variant="outlined"
        class="context-switcher"
        :label="$t('context')"
      />
    </v-app-bar>
    <router-view />
  </v-app>
</template>

<script lang="ts" setup>
import { useAppStore } from '@/store/app'
import { useCoreStore } from '@/store/core'
import { useFluent } from 'fluent-vue'
import { computed, watch } from 'vue'

const coreStore = useCoreStore()
const appStore = useAppStore()
const { $t } = useFluent()

const contextItems = computed(() => [
  {
    title: `${$t('personal-context-person')} (${coreStore.userId})`,
    value: coreStore.userId,
  },
  ...appStore.contexts
    .filter((c) => c.webId !== coreStore.userId)
    .map((c) => ({ title: c.label, value: c.webId })),
])

const currentContext = computed({
  get: () => appStore.context ?? coreStore.userId,
  set: (webId: string) => void appStore.switchContext(webId),
})

// prime the switcher list once the user is known (personal-context discovery)
watch(
  () => coreStore.userId,
  (userId) => {
    if (userId) void appStore.listSocialAgents(true)
  },
  { immediate: true }
)
</script>

<style scoped>
.context-switcher {
  max-width: 320px;
}
</style>