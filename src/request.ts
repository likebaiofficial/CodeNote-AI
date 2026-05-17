import type { ChatRequestPayload } from "./chat";

const API_URL = "http://localhost:3001/api/chat";
const REQUEST_TIMEOUT_MS = 25_000;

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type OnChunk = (chunk: string) => void;

function parseErrorMessage(rawText: string, status: number): string {
  try {
    const data = JSON.parse(rawText) as { error?: string };
    return data.error || `请求失败：${status}`;
  } catch {
    return rawText || `请求失败：${status}`;
  }
}

function parseSseEvent(eventText: string): string {
  let content = "";

  const lines = eventText.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("data:")) {
      continue;
    }

    const data = trimmedLine.slice("data:".length).trim();

    if (!data || data === "[DONE]") {
      continue;
    }

    let parsed: OpenAIStreamChunk;

    try {
      parsed = JSON.parse(data) as OpenAIStreamChunk;
    } catch {
      continue;
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const deltaContent = parsed.choices?.[0]?.delta?.content;

    if (typeof deltaContent === "string") {
      content += deltaContent;
    }
  }

  return content;
}

export async function streamExplainCode(
  payload: ChatRequestPayload,
  onChunk: OnChunk = () => {},
  externalSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();

  let isTimeout = false;

  const timeoutId = setTimeout(() => {
    isTimeout = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const handleExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", handleExternalAbort, {
      once: true,
    });
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawText = await response.text();
      throw new Error(parseErrorMessage(rawText, response.status));
    }

    if (!response.body) {
      throw new Error("当前浏览器不支持流式读取");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        for (const eventText of events) {
          const chunk = parseSseEvent(eventText);

          if (chunk) {
            fullContent += chunk;
            onChunk(chunk);
          }
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        const chunk = parseSseEvent(buffer);

        if (chunk) {
          fullContent += chunk;
          onChunk(chunk);
        }
      }

      return fullContent;
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new Error("已停止生成");
      }

      if (isTimeout) {
        throw new Error("请求超时了，模型响应太久，请稍后重试");
      }

      throw new Error("请求已中断");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("请求失败，请稍后重试");
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

export async function explainCode(
  payload: ChatRequestPayload,
): Promise<string> {
  return streamExplainCode(payload);
}
