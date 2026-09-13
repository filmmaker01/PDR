/** Результат отправки сообщения: различаем «не смогли» и «нельзя писать». */
export type SendResult =
  | { ok: true; messageId: number }
  | { ok: false; kind: 'blocked'; error: string }
  | { ok: false; kind: 'rate_limited'; retryAfterSec: number; error: string }
  | { ok: false; kind: 'failed'; error: string };

export interface InlineButton {
  text: string;
  url?: string;
  webAppUrl?: string;
  callbackData?: string;
}

export interface SendMessageInput {
  chatId: string | number;
  text: string;
  buttons?: InlineButton[][];
  disablePreview?: boolean;
}

export interface TelegramGateway {
  readonly enabled: boolean;
  sendMessage(input: SendMessageInput): Promise<SendResult>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  approveChatJoinRequest(chatId: string | number, userId: string | number): Promise<SendResult>;
  declineChatJoinRequest(chatId: string | number, userId: string | number): Promise<SendResult>;
  banChatMember(chatId: string | number, userId: string | number): Promise<SendResult>;
  unbanChatMember(chatId: string | number, userId: string | number): Promise<SendResult>;
  getChatMemberStatus(chatId: string | number, userId: string | number): Promise<string | null>;
  createChatInviteLink(chatId: string | number, name: string): Promise<string | null>;
}
