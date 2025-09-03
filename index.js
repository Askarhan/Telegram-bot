const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';

const bot = new TelegramBot(TOKEN);

app.get('/', (req, res) => {
  res.send('Сервер работает!');
});

app.post('/webhook', (req, res) => {
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error('processUpdate error:', e);
  }
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Добро пожаловать! 👋 Выберите действие:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' }],
        [{ text: 'Отзывы 💖', callback_data: 'reviews' }],
        [{ text: 'Оставить отзыв 💌', callback_data: 'leave_review' }],
      ],
    },
  });
});

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "buy_diamonds") {
    
    bot.sendMessage(chatId, "Выберите регион для отображения цен:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Россия 🇷🇺", callback_data: "region_RU" }],
          [{ text: "Кыргызстан 🇰🇬", callback_data: "region_KG" }]
        ]
      }
    });
  }

  if (query.data === "region_RU") {
    bot.sendMessage(chatId, "Цены на алмазы в рублях:\n💎 100 алмазов — 100 ₽\n💎 500 алмазов — 450 ₽\n💎 1000 алмазов — 850 ₽");
  }

  if (query.data === "region_KG") {
    bot.sendMessage(chatId, "Цены на алмазы в сомах:\n💎 100 алмазов — 8700 сом\n💎 500 алмазов — 43500 сом\n💎 1000 алмазов — 87000 сом");
  }

  if (query.data === "reviews") {
    bot.sendMessage(chatId, "Отзывы наших клиентов доступны здесь: https://t.me/ТВОЙ_КАНАЛ");
  }

  if (query.data === "leave_review") {
    bot.sendMessage(chatId, "Напишите свой отзыв администратору: @ТВОЙ_НИК");
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  const chatId = msg.chat.id;
  const text = msg.text || 'Пустое сообщение';
  bot.sendMessage(chatId, `Ты написал: ${text}`).catch(console.error);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
