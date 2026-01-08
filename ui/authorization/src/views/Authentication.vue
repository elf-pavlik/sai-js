<template>
  <v-main>
    <v-card>
      <v-card-item>
        <v-card-title>
          Sign In
        </v-card-title>
        <v-card-subtitle>
          If account doesn't exist one will be created for you
        </v-card-subtitle>
        <v-card-text>
          <v-form @submit.prevent="signIn">
            <v-text-field v-bind="$ta('email-input')" v-model="email" required />
            <v-text-field v-bind="$ta('password-input')" v-model="password" required />
            <v-btn type="submit" block class="mt-2" :disabled="!email || !password">
              {{ $t('sign-in') }}
            </v-btn>
          </v-form>
        </v-card-text>
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

async function signIn() {
  if (await coreStore.signIn(email.value, password.value)) {
    coreStore.navigateHome()
  } else {
    if (await coreStore.signUp(email.value, password.value)) {
      coreStore.navigateHome()
    } else {
      console.log('failed to create account')
    }
  }
}
</script>
