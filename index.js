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
    const text = update.message.text || 'Пустое сообщение';
    bot.sendMessage(chatId, `Ты написал: ${text}`)
       .catch(err => console.error(err));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
