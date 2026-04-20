import type { ChatRequestPayload } from "./chat";

export async function explainCode(
  payload: ChatRequestPayload,
): Promise<string> {
  const lastMessage = payload.messages[payload.messages.length - 1];
  const trimmedCode = (lastMessage?.content ?? "").trim();

  if (trimmedCode === "") {
    throw new Error(`输入内容是：${trimmedCode}`);
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 300);
  });
  return `代码解释： ${trimmedCode}`;
}
