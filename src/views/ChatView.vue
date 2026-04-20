<script setup lang="ts">
import { ref } from "vue";
import { explainCode } from "../request";

const inputCode = ref("");
const result = ref("");
const loading = ref(false);

const handleSend = async () => {
  try {
    loading.value = true;
    const res = await explainCode({
      messages: [
        {
          role: "user",
          content: inputCode.value,
        },
      ],
      mode: "explain",
    });
    result.value = res;
  } catch (e) {
    result.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <textarea v-model="inputCode"></textarea>
  <button @click="handleSend" :disabled="loading">
    {{ loading ? "发送中..." : "发送" }}
  </button>
  <pre>{{ result }}</pre>
</template>
