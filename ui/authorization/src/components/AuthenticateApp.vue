<template>
  <v-card
    v-if="application"
    :title="application.name"
    :prepend-avatar="application.logo"
  />
  <v-card>
    <div class="px-2 d-flex justify-space-between">
      <v-btn
        color="error"
        variant="tonal"
        @click="cancel()"
      >
        {{ $t('cancel') }}
      </v-btn>
      <v-btn
        color="success"
        variant="flat"
        size="large"
        @click="authorize()"
      >
        {{ $t('sign-in') }}
      </v-btn>
    </div>
  </v-card>
</template>
<script lang="ts" setup>
import { useCoreStore } from '@/store/core'
import type { Application } from '@janeirodigital/sai-api-messages'
import type * as S from 'effect/Schema'

const coreStore = useCoreStore()

const props = defineProps<{
  application?: S.Schema.Type<typeof Application>
}>()

async function cancel() {
  // TODO: cancel interaction
  if (props.application?.callbackEndpoint) {
    window.location.href = props.application?.callbackEndpoint
  }
}

async function authorize() {
  window.location.href = await coreStore.consent()
}
</script>
