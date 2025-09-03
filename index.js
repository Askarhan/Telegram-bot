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
  const update = req.body;
  res.sendStatus(200);

  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text || '';

  
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "Добро пожаловать! 👋 Выберите действие:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Купить алмазы 💎", callback_data: "buy_diamonds" }],
        [{ text: "Отзывы 💖", callback_data: "reviews" }],
        [{ text: "Оставить отзыв 💌", callback_data: "leave_review" }]
      ]
    }
  });
});

bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;

  if (query.data === "buy_diamonds") {
    bot.sendMessage(chatId, "Чтобы купить алмазы, напишите администратору: @ТВОЙ_НИК");
  }

  if (query.data === "reviews") {
    bot.sendMessage(chatId, "Отзывы наших клиентов доступны здесь: https://t.me/ТВОЙ_КАНАЛ");
  }

  if (query.data === "leave_review") {
    bot.sendMessage(chatId, "Напишите свой отзыв администратору: @ТВОЙ_НИК");
  }

  bot.answerCallbackQuery(query.id);
});
