export type ChatRole = "user" | "assistant" | "system";

export type Message = {
  role: ChatRole;
  content: string;
  status?: "normal" | "error";
};

export type ExplainMode = "explain" | "note";

export type ChatRequestPayload = {
  messages: Message[];
  mode: ExplainMode;
};

export type ChatState = {
  messages: Message[];
  loading: boolean;
};