import http from "node:http";

const PORT = 3001;
const VALID_MODES = new Set(["explain", "note"]);
const MODEL_API_KEY = process.env.MODEL_API_KEY;
const MODEL_API_URL =
  process.env.MODEL_API_URL || "https://api.deepseek.com/chat/completions";
const MODEL_NAME = process.env.MODEL_NAME || "deepseek-v4-flash";
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendStreamHeaders(res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      let data: { messages?: unknown; mode?: unknown };

      try {
        data = JSON.parse(body || "{}");
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }

      if (!Array.isArray(data.messages)) {
        sendJson(res, 400, {
          error: "Invalid payload: messages must be an array",
        });
        return;
      }

      if (typeof data.mode !== "string" || !VALID_MODES.has(data.mode)) {
        sendJson(res, 400, {
          error: "Invalid payload: mode must be 'explain' or 'note'",
        });
        return;
      }

      const messages = data.messages.filter((item): item is ChatMessage => {
        if (!item || typeof item !== "object") return false;
        const role = (item as { role?: unknown }).role;
        const content = (item as { content?: unknown }).content;
        return (
          (role === "system" || role === "user" || role === "assistant") &&
          typeof content === "string"
        );
      });

      if (messages.length === 0) {
        sendJson(res, 400, { error: "Invalid payload: messages is empty" });
        return;
      }

      if (!MODEL_API_KEY) {
        sendJson(res, 500, { error: "Missing MODEL_API_KEY on server" });
        return;
      }

      const systemPrompt =
        data.mode === "note"
          ? "你是代码笔记助手。请输出结构化 Markdown，包含：功能、核心步骤、关键点。"
          : "你是代码解释助手。请用简洁中文解释代码逻辑与关键点。";

      const upstreamMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];

      void (async () => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const controller = new AbortController();

          const timeoutId = setTimeout(() => {
            controller.abort();
          }, UPSTREAM_TIMEOUT_MS);

          try {
            const upstreamResponse = await fetch(MODEL_API_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${MODEL_API_KEY}`,
              },
              body: JSON.stringify({
                model: MODEL_NAME,
                messages: upstreamMessages,
                stream: true,
              }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!upstreamResponse.ok) {
              const raw = await upstreamResponse
                .json()
                .catch(() => ({ error: { message: "Invalid upstream JSON" } }));

              const msg =
                (raw as { error?: { message?: string } })?.error?.message ||
                `Upstream error: ${upstreamResponse.status}`;

              if (upstreamResponse.status >= 500 && attempt < MAX_RETRIES) {
                continue;
              }

              sendJson(res, 502, { error: msg });
              return;
            }

            if (!upstreamResponse.body) {
              sendJson(res, 502, {
                error: "Upstream response body is empty",
              });
              return;
            }

            sendStreamHeaders(res);

            const reader = upstreamResponse.body.getReader();

            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                if (value) {
                  res.write(Buffer.from(value));
                }
              }
            } finally {
              reader.releaseLock();
              res.end();
            }

            return;
          } catch (error: unknown) {
            clearTimeout(timeoutId);

            const isAbort =
              error instanceof Error && error.name === "AbortError";

            if (!isAbort && attempt < MAX_RETRIES) {
              continue;
            }

            if (res.headersSent) {
              res.end();
              return;
            }

            if (isAbort) {
              sendJson(res, 504, { error: "模型响应超时，请稍后重试" });
              return;
            }

            console.error(error);
            sendJson(res, 500, { error: "模型调用失败" });
            return;
          }
        }
      })();
    });

    return;
  }

  sendJson(res, 404, { error: "Not Found" });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
