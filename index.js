const TelegramBot = require('node-telegram-bot-api');
const token = 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeText = "Привет! Добро пожаловать в DIAMOND STORE 💎\nВыберите регион:";
  const regionButtons = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇷🇺 RU", callback_data: "region_RU" }],
        [{ text: "🇰🇬 KG", callback_data: "region_KG" }]
      ]
    }
  };
  bot.sendMessage(chatId, welcomeText, regionButtons);
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;

  switch(query.data) {
    case 'region_RU':
    case 'region_KG':
      bot.sendMessage(chatId, "Выберите действие:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Купить алмазы💎", callback_data: "buy_diamonds" }],
            [{ text: "Отзывы💖", callback_data: "view_reviews" }],
            [{ text: "Оставить отзыв💌", callback_data: "leave_review" }]
          ]
        }
      });
      break;

    case "buy_diamonds":
      bot.sendMessage(chatId, "Выберите пакет алмазов:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Weekly Diamond Pass — 217 ₽", callback_data: "diamond_weekly" }],
            [{ text: "Twilight Pass — 858 ₽", callback_data: "diamond_twilight" }],
            [{ text: "56 Diamonds — 124 ₽", callback_data: "diamond_56" }],
            [{ text: "86 Diamonds — 153 ₽", callback_data: "diamond_86" }],
            [{ text: "172 Diamonds — 280 ₽", callback_data: "diamond_172" }],
            [{ text: "257 Diamonds — 411 ₽", callback_data: "diamond_257" }],
            [{ text: "706 Diamonds — 1 224 ₽", callback_data: "diamond_706" }],
            [{ text: "2195 Diamonds — 3 623 ₽", callback_data: "diamond_2195" }],
            [{ text: "3688 Diamonds — 6 009 ₽", callback_data: "diamond_3688" }],
            [{ text: "5532 Diamonds — 8 879 ₽", callback_data: "diamond_5532" }],
            [{ text: "9288 Diamonds — 14 980 ₽", callback_data: "diamond_9288" }]
          ]
        }
      });
      break;

    case "view_reviews":
      bot.sendMessage(chatId, "Отзывы пока в разработке 💖");
      break;

    case "leave_review":
      bot.sendMessage(chatId, "Напишите свой отзыв здесь 💌");
      break;

    case "diamond_weekly":
    case "diamond_twilight":
    case "diamond_56":
    case "diamond_86":
    case "diamond_172":
    case "diamond_257":
    case "diamond_706":
    case "diamond_2195":
    case "diamond_3688":
    case "diamond_5532":
    case "diamond_9288":
      bot.sendMessage(chatId, "Чтобы купить этот пакет алмазов, напишите администратору: @ТВОЙ_НИК");
      break;

    default:
      bot.sendMessage(chatId, "Выберите действие из меню.");
  }

  bot.answerCallbackQuery(query.id);
});
