const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';

const bot = new TelegramBot(TOKEN, { polling: true });

let selectedRegion = 'RU';

// Данные о пакетах алмазов в виде объектов
const diamondsData = [
    { amount: 56, price: 124 },
    { amount: 86, price: 152 },
    { amount: 172, price: 280 },
    { amount: 257, price: 411 },
    { amount: 706, price: 1224 },
    { amount: 2195, price: 3105 },
    { amount: 3688, price: 5069 },
    { amount: 5532, price: 7446 },
    { amount: 9288, price: 12980 }
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
    // Отправляем статус 200, даже если произошла ошибка, чтобы Telegram не повторял запрос.
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
    const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
    const keyboard = [];
    let currentRow = [];

    // Динамически создаем кнопки на основе данных
    diamondsData.forEach((d, index) => {
        currentRow.push({
            text: `${d.amount} Diamonds — ${d.price.toLocaleString('ru-RU')} ${currency}`,
            callback_data: `diamond_${d.amount}`
        });

        // Добавляем строку в клавиатуру, когда в ней 2 элемента
        if (currentRow.length === 2 || index === diamondsData.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
        }
    });

    keyboard.push([{ text: 'Назад 🔙', callback_data: 'back_to_start' }]);

    await bot.sendMessage(chatId, 'Выберите пакет алмазов:', {
        reply_markup: { inline_keyboard: keyboard },
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
