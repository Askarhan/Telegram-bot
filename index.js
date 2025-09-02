const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;

// Токен твоего бота
const TOKEN = "8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w";
const bot = new TelegramBot(TOKEN, { polling: true });

// Простейший ответ на любое сообщение
bot.on("message", (msg) => {
  bot.sendMessage(msg.chat.id, `Привет! Ты написал: ${msg.text}`);
});

// Главная страница сервера
app.get("/", (req, res) => {
  res.send("Сервер работает! 🚀");
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
