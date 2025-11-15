<template>
  <v-main>
    <v-card>
      <v-card-item>
        <v-form @submit.prevent="login">
          <v-text-field label="email" v-model="email" required />
          <v-text-field label="password" v-model="password" required />
          <v-btn type="submit" block class="mt-2" :disabled="!email || !password">
            {{ $t('sign-in') }}
          </v-btn>
        </v-form>
      </v-card-item>
    </v-card>
  </v-main>
</template>

<script lang="ts" setup>
import { useCoreStore } from '@/store/core'
import { ref } from 'vue'

const coreStore = useCoreStore()

const email = ref('')
const password = ref('')

// TODO: validate webId
async function login() {
  return coreStore.login(email.value, password.value)
}
</script>
