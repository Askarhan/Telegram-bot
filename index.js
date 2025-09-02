const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';
const bot = new TelegramBot(TOKEN);

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Сервер работает!');
});

app.post('/bot8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w', (req, res) => {
app.post('/webhook', (req, res) => {
  const update = req.body;
  console.log(update);

  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text || 'Пустое сообщение';
    bot.sendMessage(chatId, `Ты написал: ${text}`);
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
