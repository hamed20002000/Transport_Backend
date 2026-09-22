import { Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';

interface ChatKeyboard {
  messageId?: number;
  pending?: Promise<unknown>;
  mainMenu?: TelegramBot.Message;
  mainMenuSignature?: string;
}

const keyboards = new WeakMap<TelegramBot, Map<string, ChatKeyboard>>();
const logger = new Logger('TelegramKeyboard');

/** Keep one main menu and delete superseded operation messages. */
export async function sendTelegramMessage(
  bot: TelegramBot,
  chatId: string,
  text: string,
  options?: TelegramBot.SendMessageOptions,
  isMainMenu = false,
): Promise<TelegramBot.Message> {
  // Informational/error messages should leave the current actions available.
  if (!options?.reply_markup) return bot.sendMessage(chatId, text, options);

  // The library mutates options.reply_markup into a JSON string during sendMessage.
  // Capture its meaning before sending and pass a copy to protect caller options.

  let chats = keyboards.get(bot);
  if (!chats) {
    chats = new Map();
    keyboards.set(bot, chats);
  }
  let state = chats.get(chatId);
  if (!state) {
    state = {};
    chats.set(chatId, state);
  }
  const current = state;
  // Serialize keyboard transitions in each chat, including concurrent callbacks.
  const operation = (current.pending ?? Promise.resolve()).then(async () => {
    const previousId = current.messageId;
    const signature = JSON.stringify({ text, options });
    let message: TelegramBot.Message;
    if (isMainMenu && current.mainMenu) {
      message = current.mainMenu;
      if (previousId !== message.message_id || current.mainMenuSignature !== signature) {
        try {
          await bot.editMessageText(text, {
            ...options,
            chat_id: chatId,
            message_id: message.message_id,
            reply_markup: options.reply_markup as TelegramBot.InlineKeyboardMarkup,
          });
        } catch (error) {
          const description = (error as { response?: { body?: { description?: string } } })
            .response?.body?.description ?? '';
          if (/message is not modified/i.test(description)) {
            // The desired menu is already visible.
          } else if (/message to edit not found|message can't be edited/i.test(description)) {
            message = await bot.sendMessage(chatId, text, { ...options });
          } else {
            throw error;
          }
        }
      }
    } else {
      message = await bot.sendMessage(chatId, text, { ...options });
    }
    if (isMainMenu) {
      current.mainMenu = message;
      current.mainMenuSignature = signature;
    }
    current.messageId = message.message_id;

    if (previousId !== undefined && previousId !== message.message_id) {
      try {
        if (previousId === current.mainMenu?.message_id) {
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId, message_id: previousId,
          });
        } else {
          await bot.deleteMessage(chatId, previousId);
        }
      } catch {
        logger.warn(`Could not remove previous operation in chat ${chatId}, message ${previousId}.`);
      }
    }
    return message;
  });
  const settled = operation.catch(() => undefined);
  current.pending = settled;
  try {
    return await operation;
  } finally {
    if (current.pending === settled) {
      current.pending = undefined;
      if (current.messageId === undefined) chats.delete(chatId);
    }
  }
}

export function sendTelegramMainMenu(
  bot: TelegramBot,
  chatId: string,
  text: string,
  options: TelegramBot.SendMessageOptions,
): Promise<TelegramBot.Message> {
  return sendTelegramMessage(bot, chatId, text, options, true);
}
