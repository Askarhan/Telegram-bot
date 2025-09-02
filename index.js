const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json());

const TOKEN = process.env.TOKEN;
const bot = new TelegramBot(TOKEN); 

bot.on("message", (msg) => {
  bot.sendMessage(msg.chat.id, `Привет! Ты написал: ${msg.text}`);
});

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Сервер работает! 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
