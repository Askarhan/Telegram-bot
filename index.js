const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;
const TOKEN = '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';

const bot = new TelegramBot(TOKEN);

const adminChatId = 895583535;

const waitingForAction = {};
let selectedRegion = 'RU';

const diamondsDataRU = [
    { amount: 56, price: 124 },
    { amount: 86, price: 152 },
    { amount: 172, price: 280 },
    { amount: 257, price: 411 },
    { amount: 706, price: 1224 },
    { amount: 2195, price: 3105 },
    { amount: 3688, price: 4292 },
    { amount: 5532, price: 6342 },
    { amount: 9288, price: 10700 }
];

const diamondsDataKG = [
    { amount: 'Алмазный пропуск (w)', price: 181 },
    { amount: 'Сумеречный пропуск', price: 715 },
    { amount: 56, price: 104 },
    { amount: 86, price: 127 },
    { amount: 172, price: 234 },
    { amount: 257, price: 343 },
    { amount: 706, price: 874 },
    { amount: 2195, price: 2588 },
    { amount: 3688, price: 4292 },
    { amount: 5532, price: 6342 },
    { amount: 9288, price: 10700 }
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
    showMainMenu(chatId);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (waitingForAction[chatId]) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = orderData.region === 'RU' ? '₽' : 'KGS';

            const adminMessage =
                `📢 **НОВЫЙ ЗАКАЗ**\n\n` +
                `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                `**Сумма:** ${selectedItem.price} ${currency}\n` +
                `**Пользователь:** ${msg.from.username ? `@${msg.from.username}` : msg.from.first_name}\n` +
                `**ID пользователя:** ${msg.from.id}\n` +
                `**ID игрока MLBB:** ${playerId}`;
            
            await bot.sendMessage(adminChatId, adminMessage, { parse_mode: 'Markdown' });

            const userMessageText =
                `К оплате ${selectedItem.price} ${currency}.\n\n` +
                `**Переведите средства на:**\n` +
                `[ВАШИ РЕКВИЗИТЫ]\n\n` +
                `*После оплаты нажмите "Я оплатил ✅".*`;
            
            await bot.sendMessage(
                chatId,
                userMessageText,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Я оплатил ✅', callback_data: `paid` }],
                            [{ text: 'Назад', callback_data: 'back_to_regions' }]
                        ]
                    }
                }
            );

            delete waitingForAction[chatId];
        } else if (waitingForAction[chatId].step === 'screenshot' && msg.photo) {
            const photoId = msg.photo[msg.photo.length - 1].file_id;

            await bot.sendPhoto(adminChatId, photoId, { caption: `Скриншот оплаты от пользователя: ${msg.from.username ? `@${msg.from.username}` : msg.from.first_name}` });

            await bot.sendMessage(
                chatId,
                'Спасибо за покупку, мы пополним ваш аккаунт после подтверждения оплаты!\nСпасибо за доверие, ждите свои алмазы❤️'
            );

            delete waitingForAction[chatId];
        }
    }
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    try {
        if (q.data === 'buy_diamonds') {
            await editToRegionMenu(chatId, messageId);
        } else if (q.data === 'region_ru') {
            selectedRegion = 'RU';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'region_kg') {
            selectedRegion = 'KG';
            await editToDiamondsMenu(chatId, messageId);
        } else if (q.data === 'reviews') {
            await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/ТВОЙ_КАНАЛ');
        } else if (q.data === 'leave_review') {
            await bot.sendMessage(chatId, 'Оставить отзыв: @ТВОЙ_НИК');
        } else if (q.data === 'back_to_start') {
            await editToMainMenu(chatId, messageId);
        } else if (q.data === 'back_to_regions') {
            await editToRegionMenu(chatId, messageId);
        } else if (q.data.startsWith('diamond_')) {
            const selectedItemIndex = q.data.split('_')[1];
            const diamondsData = selectedRegion === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem =
