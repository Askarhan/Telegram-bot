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

    if (text === '/start') {
      bot.sendMessage(chatId, 'Привет! Я твой бот. Напиши что-нибудь, и я повторю это.');
    } else if (text === '/help') {
      bot.sendMessage(chatId, 'Список команд:\n/start — начать\n/help — помощь\n/buttons — кнопки');
    } else if (text === '/buttons') {
      bot.sendMessage(chatId, 'Выбери действие:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Привет', callback_data: 'say_hello' }],
            [{ text: 'Пока', callback_data: 'say_bye' }]
          ]
        }
      });
    } else {
      bot.sendMessage(chatId, `Ты написал: ${text}`).catch(err => console.error(err));
    }
  }

  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const data = update.callback_query.data;

    if (data === 'say_hello') {
      bot.sendMessage(chatId, 'Привет!');
    } else if (data === 'say_bye') {
      bot.sendMessage(chatId, 'Пока!');
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
