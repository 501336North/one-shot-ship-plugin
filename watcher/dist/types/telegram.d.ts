/**
 * Telegram notification types for OSS Dev Workflow
 */
export interface TelegramConfig {
    enabled: boolean;
    botToken: string;
    chatId: string;
}
export interface TelegramButton {
    text: string;
    callbackData: string;
}
export interface TelegramMessage {
    message_id: number;
    chat: {
        id: number;
    };
    text?: string;
}
export interface TelegramCallbackQuery {
    id: string;
    data: string;
    message?: TelegramMessage;
}
export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    callback_query?: TelegramCallbackQuery;
}
export declare const DEFAULT_TELEGRAM_CONFIG: TelegramConfig;
//# sourceMappingURL=telegram.d.ts.map