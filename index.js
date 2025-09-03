const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';

const bot = new TelegramBot(TOKEN);

let selectedRegion = 'RU'; // по умолчанию RU

const diamonds = [
  { name: 'Weekly Diamond Pass', ru: 217, kg: 217 },
  { name: 'Twilight Pass', ru: 858, kg: 858 },
  { name: '56 Diamonds', ru: 124, kg: 124 },
  { name: '86 Diamonds', ru: 152, kg: 152 },
  { name: '172 Diamonds', ru: 280, kg: 280 },
  { name: '257 Diamonds', ru: 411, kg: 411 },
  { name: '706 Diamonds', ru: 1224, kg: 1224 },
  { name: '2195 Diamonds', ru: 3106, kg: 3106 },
  { name: '3688 Diamonds', ru: 5150, kg: 5150 },
  { name: '5532 Diamonds', ru: 7610, kg: 7610 },
  { name: '9288 Diamonds', ru: 12868, kg: 12868 },
];

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

async function showDiamonds(chatId) {
  const diamondButtons = diamonds.map(d => ({
    text: `${d.name} — ${selectedRegion === 'RU' ? d.ru : d.kg} ₽`,
    callback_data: 'buy_diamonds_item'
  }));

  const keyboard = [];
  for (let i = 0; i < diamondButtons.length; i += 2) {
    if (i + 1 < diamondButtons.length) {
      keyboard.push([diamondButtons[i], diamondButtons[i + 1]]);
    } else {
      keyboard.push([diamondButtons[i]]);
    }
  }

  keyboard.push([{ text: 'Назад 🔙', callback_data: 'back_to_start' }]);
  keyboard.push([
    { text: 'RU 🇷🇺', callback_data: 'region_ru' },
    { text: 'KG 🇰🇬', callback_data: 'region_kg' }
  ]);

  await bot.sendMessage(chatId, 'Выберите алмазы:', {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;

  try {
    if (q.data === 'region_ru') {
      selectedRegion = 'RU';
      await bot.sendMessage(chatId, 'Регион выбран: Россия 🇷🇺');
      await showDiamonds(chatId);
    } else if (q.data === 'region_kg') {
      selectedRegion = 'KG';
      await bot.sendMessage(chatId, 'Регион выбран: Кыргызстан 🇰🇬');
      await showDiamonds(chatId);
    } else if (q.data === 'buy_diamonds') {
      await showDiamonds(chatId);
    } else if (q.data === 'back_to_start') {
      await bot.sendMessage(chatId, 'Возвращаемся в главное меню:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' }],
            [{ text: 'Отзывы 💖', callback_data: 'reviews' }],
            [{ text: 'Оставить отзыв 💌', callback_data: 'leave_review' }],
          ],
        },
      });
    } else if (q.data === 'reviews') {
      await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/ТВОЙ_КАНАЛ');
    } else if (q.data === 'leave_review') {
      await bot.sendMessage(chatId, 'Оставить отзыв: @ТВОЙ_НИК');
    } else if (q.data === 'buy_diamonds_item') {
      await bot.sendMessage(chatId, 'Чтобы купить, напишите администратору: @ТВОЙ_НИК');
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
