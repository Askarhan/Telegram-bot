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

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  try {
    if (q.data === 'buy_diamonds') {
      await bot.sendMessage(chatId, 'Чтобы купить алмазы, напишите администратору: @ТВОЙ_НИК');
    } else if (q.data === 'reviews') {
      await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/ТВОЙ_КАНАЛ');
    } else if (q.data === 'leave_review') {
      await bot.sendMessage(chatId, 'Оставить отзыв: @ТВОЙ_НИК');
    }
    await bot.answerCallbackQuery(q.id);
  } catch (e) {
    console.error('callback error:', e);
  }
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
