const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';

const bot = new TelegramBot(TOKEN, { polling: true });

let selectedRegion = 'RU';

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
  bot.sendMessage(chatId, 'Добро пожаловать! 👋 Выберите регион:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇷🇺 RU', callback_data: 'region_ru' },
          { text: '🇰🇬 KG', callback_data: 'region_kg' }
        ]
      ],
    },
  });
});

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  try {
    if (q.data === 'region_ru') {
      selectedRegion = 'RU';
      await showMainMenu(chatId);
    } else if (q.data === 'region_kg') {
      selectedRegion = 'KG';
      await showMainMenu(chatId);
    } else if (q.data === 'buy_diamonds') {
      await showDiamonds(chatId);
    } else if (q.data === 'reviews') {
      await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/ТВОЙ_КАНАЛ');
    } else if (q.data === 'leave_review') {
      await bot.sendMessage(chatId, 'Оставить отзыв: @ТВОЙ_НИК');
    } else if (q.data === 'back_to_start') {
      await showMainMenu(chatId);
    }
    await bot.answerCallbackQuery(q.id);
  } catch (e) {
    console.error('callback error:', e);
  }
});

async function showMainMenu(chatId) {
  await bot.sendMessage(chatId, 'Главное меню:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' },
          { text: 'Отзывы 💖', callback_data: 'reviews' }
        ],
        [{ text: 'Оставить отзыв 💌', callback_data: 'leave_review' }]
      ]
    }
  });
}

async function showDiamonds(chatId) {
  const diamondsRU = [
    ['56 Diamonds — 124 ₽', '86 Diamonds — 152 ₽'],
    ['172 Diamonds — 280 ₽', '257 Diamonds — 411 ₽'],
    ['706 Diamonds — 1 224 ₽', '2195 Diamonds — 3 105 ₽'],
    ['3688 Diamonds — 5 069 ₽', '5532 Diamonds — 7 446 ₽'],
    ['9288 Diamonds — 12 980 ₽']
  ];

  const diamondsKG = [
    ['56 Diamonds — 124 KGS', '86 Diamonds — 152 KGS'],
    ['172 Diamonds — 280 KGS', '257 Diamonds — 411 KGS'],
    ['706 Diamonds — 1 224 KGS', '2195 Diamonds — 3 105 KGS'],
    ['3688 Diamonds — 5 069 KGS', '5532 Diamonds — 7 446 KGS'],
    ['9288 Diamonds — 12 980 KGS']
  ];

  const diamonds = selectedRegion === 'RU' ? diamondsRU : diamondsKG;

  const keyboard = diamonds.map(row =>
    row.map((d, i) => ({ text: d, callback_data: `diamond_${i + 1}` }))
  );

  for (let row of keyboard) {
    if (row.length === 1) {
      row.push({ text: ' ', callback_data: 'empty' });
    }
  }

  keyboard.push([{ text: 'Назад 🔙', callback_data: 'back_to_start' }]);

  await bot.sendMessage(chatId, 'Выберите пакет алмазов:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
