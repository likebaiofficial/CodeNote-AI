<script setup lang="ts">
import MarkdownIt from "markdown-it";
import Prism from "prismjs";
import { nextTick, ref, watch } from "vue";
import type { ExplainMode, Message } from "../chat";
import { streamExplainCode } from "../request";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";

const inputCode = ref("");
const loading = ref(false);
const messages = ref<Message[]>([]);
const mode = ref<ExplainMode>("explain");
const currentAbortController = ref<AbortController | null>(null);

const MAX_CONTEXT_MESSAGES = 12;

const messageListRef = ref<HTMLElement | null>(null);
const bottomRef = ref<HTMLElement | null>(null);

const escapeHtml = (text: string) => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
};

const md = new MarkdownIt({
  breaks: true,
  linkify: true,
  highlight(code: string, lang: string) {
    if (lang && Prism.languages[lang]) {
      const highlighted = Prism.highlight(code, Prism.languages[lang], lang);
      return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
    }

    const escapedCode = escapeHtml(code);
    return `<pre><code>${escapedCode}</code></pre>`;
  },
});

const onCopy = async (code: string) => {
  try {
    await navigator.clipboard.writeText(code);
    console.log("复制成功");
  } catch (error) {
    console.error("复制失败", error);
  }
};

const renderCopyButtons = () => {
  const container = messageListRef.value;

  if (!container) {
    return;
  }

  const preList = container.querySelectorAll(".markdown-body pre");

  preList.forEach((pre) => {
    if (pre.querySelector(".copy-button")) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "复制";
    button.className = "copy-button";

    button.addEventListener("click", async () => {
      const code = pre.querySelector("code")?.textContent ?? "";
      await onCopy(code);
      button.textContent = "已复制";

      setTimeout(() => {
        button.textContent = "复制";
      }, 1200);
    });

    pre.appendChild(button);
  });
};

watch(
  messages,
  async () => {
    await nextTick();
    renderCopyButtons();
    bottomRef.value?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  },
  { deep: true },
);

const handleStop = () => {
  currentAbortController.value?.abort();
};

const handleClear = () => {
  messages.value = [];
};

const getMessageTitle = (message: Message) => {
  if (message.status === "error") {
    return "错误";
  }

  return message.role === "user" ? "你" : "AI";
};

const handleSend = async () => {
  const trimmedCode = inputCode.value.trim();

  if (!trimmedCode || loading.value) {
    return;
  }

  const currentMode = mode.value;
  const abortController = new AbortController();
  currentAbortController.value = abortController;

  try {
    loading.value = true;

    const userMessage: Message = {
      role: "user",
      content: trimmedCode,
    };

    messages.value.push(userMessage);
    inputCode.value = "";

    const requestMessages = messages.value.slice(-MAX_CONTEXT_MESSAGES);

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
      abortController.signal,
    );
  } catch (error) {
    const errorText = (error as Error).message;
    const lastMessage = messages.value[messages.value.length - 1];

    if (errorText === "已停止生成") {
      if (lastMessage?.role === "assistant") {
        if (lastMessage.content) {
          lastMessage.content += "\n\n（已停止生成）";
        } else {
          lastMessage.content = "已停止生成";
          lastMessage.status = "error";
        }
      }
      return;
    }

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
    currentAbortController.value = null;
  }
};
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <h1>CodeNote AI</h1>
      <p>
        输入代码，选择解释模式或笔记模式，让 AI 帮你理解和整理代码
      </p>
    </header>

    <section class="input-panel">
      <label class="panel-label" for="code-input">代码输入</label>
      <textarea
        id="code-input"
        v-model="inputCode"
        class="code-input"
        placeholder="粘贴代码，选择模式后点击发送..."
      ></textarea>

      <div class="toolbar">
        <div class="mode-group">
          <button
            class="mode-btn"
            :class="{ active: mode === 'explain' }"
            :disabled="loading"
            @click="mode = 'explain'"
          >
            解释模式
          </button>

          <button
            class="mode-btn"
            :class="{ active: mode === 'note' }"
            :disabled="loading"
            @click="mode = 'note'"
          >
            笔记模式
          </button>
        </div>

        <div class="action-group">
          <button class="btn btn-primary" :disabled="loading" @click="handleSend">
            {{ loading ? "生成中..." : "发送" }}
          </button>

          <button
            class="btn btn-secondary"
            :disabled="loading || messages.length === 0"
            @click="handleClear"
          >
            清空对话
          </button>

          <button v-if="loading" class="btn btn-danger" @click="handleStop">
            停止生成
          </button>
        </div>
      </div>
    </section>

    <section ref="messageListRef" class="chat-panel">
      <div v-if="messages.length === 0" class="empty-state">
        <h2>开始你的第一次代码解析</h2>
        <p>粘贴一段代码后，选择模式并发送，AI 会按流式输出结果。</p>
      </div>

      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-item"
        :class="{
          'user-message': message.role === 'user' && message.status !== 'error',
          'assistant-message': message.role === 'assistant' && message.status !== 'error',
          'error-message': message.status === 'error',
        }"
      >
        <div class="message-title">{{ getMessageTitle(message) }}</div>

        <pre v-if="message.role === 'user' || message.status === 'error'" class="plain-content">{{
          message.content
        }}</pre>

        <div
          v-else
          class="markdown-body"
          v-html="md.render(message.content)"
        ></div>
      </div>

      <div ref="bottomRef" class="bottom-anchor"></div>
    </section>
  </main>
</template>

<style scoped>
.app-shell {
  max-width: 1024px;
  margin: 0 auto;
  min-height: 100vh;
  padding: 28px 20px 40px;
  box-sizing: border-box;
}

.hero {
  margin-bottom: 18px;
}

.hero h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #171923;
}

.hero p {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.65;
  color: #4a5568;
}

.input-panel,
.chat-panel {
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid #e4e7ec;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.07);
}

.input-panel {
  padding: 16px;
}

.panel-label {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #475467;
}

.code-input {
  width: 100%;
  min-height: 170px;
  resize: vertical;
  border: 1px solid #222b45;
  border-radius: 12px;
  padding: 14px;
  box-sizing: border-box;
  background: #101827;
  color: #e5edf9;
  font: 14px/1.6 "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
}

.code-input::placeholder {
  color: #93a3bb;
}

.code-input:focus {
  outline: none;
  border-color: #4f7cff;
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.18);
}

.toolbar {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mode-group,
.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mode-btn,
.btn {
  border-radius: 10px;
  border: 1px solid transparent;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.mode-btn {
  border-color: #d0d5dd;
  background: #ffffff;
  color: #344054;
}

.mode-btn.active {
  border-color: #2f61f6;
  background: #eaf0ff;
  color: #1d4ed8;
}

.btn-primary {
  background: #2f61f6;
  color: #ffffff;
}

.btn-primary:hover {
  background: #2453d7;
}

.btn-secondary {
  border-color: #d0d5dd;
  background: #ffffff;
  color: #344054;
}

.btn-secondary:hover {
  background: #f8fafc;
}

.btn-danger {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b42318;
}

.btn-danger:hover {
  background: #fecaca;
}

.mode-btn:disabled,
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chat-panel {
  margin-top: 14px;
  padding: 16px;
  max-height: calc(100vh - 360px);
  min-height: 260px;
  overflow: auto;
}

.empty-state {
  padding: 32px 18px;
  border-radius: 12px;
  border: 1px dashed #d0d5dd;
  background: #f8fafc;
  text-align: center;
}

.empty-state h2 {
  margin: 0;
  font-size: 18px;
  color: #101828;
}

.empty-state p {
  margin: 8px 0 0;
  color: #475467;
  font-size: 14px;
}

.message-item {
  margin: 0 0 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #e4e7ec;
}

.user-message {
  background: #eef4ff;
  border-color: #d4e0ff;
}

.assistant-message {
  background: #ffffff;
}

.error-message {
  background: #fff1f0;
  border-color: #ffccc7;
  color: #a8071a;
}

.message-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #344054;
}

.error-message .message-title {
  color: #a8071a;
}

.plain-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font: 14px/1.6 "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
}

.markdown-body {
  line-height: 1.7;
  color: #101828;
  word-break: break-word;
}

.markdown-body :deep(p) {
  margin: 0 0 10px;
}

.markdown-body :deep(h2) {
  margin: 12px 0 8px;
  font-size: 20px;
  color: #0f172a;
}

.markdown-body :deep(ul) {
  margin: 8px 0;
  padding-left: 22px;
}

.markdown-body :deep(li) {
  margin-bottom: 6px;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: #f2f4f7;
  font: 13px "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
}

.markdown-body :deep(pre) {
  position: relative;
  margin: 10px 0;
  padding: 14px;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: inherit;
}

.markdown-body :deep(.copy-button) {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #1f2937;
  color: #e2e8f0;
  font-size: 12px;
  cursor: pointer;
}

.markdown-body :deep(.copy-button:hover) {
  background: #334155;
}

.bottom-anchor {
  height: 2px;
}

@media (max-width: 768px) {
  .app-shell {
    padding: 16px 12px 24px;
  }

  .hero h1 {
    font-size: 28px;
  }

  .chat-panel {
    max-height: calc(100vh - 340px);
  }
}
</style>
