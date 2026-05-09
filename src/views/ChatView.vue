<script setup lang="ts">
import { ref } from "vue";
import { streamExplainCode } from "../request";
import type { ExplainMode, Message } from "../chat";
const inputCode = ref("");
const loading = ref(false);
const messages = ref<Message[]>([]);
const mode = ref<ExplainMode>("explain");

const handleSend = async () => {
  const trimmedCode = inputCode.value.trim();

  if (!trimmedCode || loading.value) {
    return;
  }

  const currentMode = mode.value;

  try {
    loading.value = true;

    const userMessage: Message = {
      role: "user",
      content: trimmedCode,
    };

    messages.value.push(userMessage);
    inputCode.value = "";

    // 注意：这里先保存本次要发给后端的消息
    // 不要把下面那条空的 assistant 消息也发给模型
    const requestMessages = [...messages.value];

    const assistantMessage: Message = {
      role: "assistant",
      content: "",
    };

    messages.value.push(assistantMessage);

    const assistantIndex = messages.value.length - 1;

    await streamExplainCode(
      {
        messages: requestMessages,
        mode: currentMode,
      },
      (chunk) => {
        messages.value[assistantIndex].content += chunk;
      },
    );
  } catch (e) {
    const errorText = (e as Error).message;

    const lastMessage = messages.value[messages.value.length - 1];

    if (lastMessage?.role === "assistant" && !lastMessage.content) {
      lastMessage.content = errorText;
      lastMessage.status = "error";
    } else {
      const errorMessage: Message = {
        role: "assistant",
        content: errorText,
        status: "error",
      };

      messages.value.push(errorMessage);
    }
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
  <div class="mode-selector">
    <button
      :class="{ active: mode === 'explain' }"
      :disabled="loading"
      @click="mode = 'explain'"
    >
      解释模式
    </button>

    <button
      :class="{ active: mode === 'note' }"
      :disabled="loading"
      @click="mode = 'note'"
    >
      笔记模式
    </button>
  </div>
  <div>
    <div
      v-for="(message, index) in messages"
      :key="index"
      :class="[
        'message-item',
        message.status === 'error' ? 'error-message' : '',
      ]"
    >
      <strong>
        {{
          message.status === "error"
            ? "错误"
            : message.role === "user"
              ? "你"
              : "AI"
        }}
      </strong>

      <pre>{{ message.content }}</pre>
    </div>
  </div>
</template>
<style scoped>
.message-item {
  margin: 12px 0;
  padding: 12px;
  border-radius: 8px;
  background: #f6f6f6;
}

.error-message {
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #a8071a;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
