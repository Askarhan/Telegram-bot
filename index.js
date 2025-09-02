// Подключаем библиотеку express
const express = require("express");
const app = express();

// Порт, на котором будет работать сервер
const PORT = process.env.PORT || 3000;

// Главная страница
app.get("/", (req, res) => {
  res.send("Сервер работает! 🚀");
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
