Const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT;
const TOKEN = process.env.TOKEN || '8370855958:AAHC8ry_PsUqso_jC2sAS9CnQnfURk1UW3w';
const MONGO_URI = process.env.MONGO_URI;


const CRYPTOCLOUD_API_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTmprMk5URT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiI4YTFlZTY2NzU3YmZiNGJmMzk2NWZiOTQyM2ZjZTI2N2I3MTllMjEyNWZkMmJjNWMzNWExMTNkMTcyZThlMWU5IiwiZXhwIjo4ODE1NjkyODU5NX0.tupMgUWPHW4a1mvdb0oarSMln4P7AFRGxbBJtorHaxw';
const CRYPTOCLOUD_SHOP_ID = '6Pi76JVyHST5yALH';

const bot = new TelegramBot(TOKEN);
const client = new MongoClient(MONGO_URI);

const adminChatId = 895583535;

const waitingForAction = {};
let selectedRegion = 'RU';
let db;

async function connectToDb() {
    try {
        await client.connect();
        db = client.db('bot_db');
        console.log("Connected to MongoDB");
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
    }
}

connectToDb();

const diamondsDataRU = [
    { amount: 'Недельный алмазный пропуск', price: 217 },
    { amount: 'Сумеречный пропуск', price: 858 },
    { amount: 56, price: 124 },
    { amount: 86, price: 152 },
    { amount: 172, price: 280 },
    { amount: 257, price: 411 },
    { amount: 706, price: 1224 },
    { amount: 2195, price: 3106 },
    { amount: 3688, price: 5150 },
    { amount: 5532, price: 7470 },
    { amount: 9288, price: 12980 }
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

app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (data.status === 'success') {
            const userId = data.payload.chatId;

            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ chatId: userId });
            let purchases = user ? user.purchases : 0;
            purchases++;

            await usersCollection.updateOne(
                { chatId: userId },
                { $set: { purchases: purchases, lastPurchase: new Date() } },
                { upsert: true }
            );

            await bot.sendMessage(userId, '✅ **Ваша оплата подтверждена!** Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!', { parse_mode: 'Markdown' });
            
            if (purchases % 5 === 0) {
                await bot.sendMessage(userId, `🎉 **Поздравляем!** 🎉 Вы совершили ${purchases} покупок и получаете бонус — **50 бонусных алмазов!**`, { parse_mode: 'Markdown' });
            }
            
            await bot.sendMessage(adminChatId, `✅ **Новая оплата через CryptoCloud!**\nПользователь: ${data.payload.username}\nСумма: ${data.amount} ${data.currency}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userId}` }]
                    ]
                }
            });

        }

        res.sendStatus(200);
    } catch (e) {
        console.error('Webhook error:', e);
        res.sendStatus(500);
    }
});

app.post('/webhook_telegram', (req, res) => {
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

bot.onText(/\/mybonus/, async (msg) => {
    const chatId = msg.chat.id;
    if (!db) {
        await bot.sendMessage(chatId, 'Ошибка: база данных не подключена.');
        return;
    }
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ chatId: chatId });
    const purchases = user ? user.purchases : 0;
    const untilBonus = 5 - (purchases % 5);

    if (purchases === 0) {
        await bot.sendMessage(chatId, `У вас пока нет покупок. Совершите 5 покупок, чтобы получить бонус!`);
    } else {
        await bot.sendMessage(chatId, `Вы совершили ${purchases} покупок. Осталось ${untilBonus} до получения бонуса!`);
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const isBotCommand = msg.text && msg.text.startsWith('/');

    if (waitingForAction[chatId] && !isBotCommand) {
        if (waitingForAction[chatId].step === 'playerId') {
            const playerId = msg.text;
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';

            
            waitingForAction[chatId].step = 'paymentChoice';
            waitingForAction[chatId].playerId = playerId;
            
            await bot.sendMessage(chatId, 
                `Вы выбрали **${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}** ` +
                `Стоимость: **${selectedItem.price}** ${currency} 💰\n` +
                `Пожалуйста, оплатите данную покупку, выбрав удобный вам способ оплаты!`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Оплата переводом', callback_data: `pay_transfer_${orderData.index}` }],
                            [{ text: 'Оплата криптовалютой', callback_data: `pay_crypto_${orderData.index}` }]
                        ]
                    }
                }
            );

        } else if (waitingForAction[chatId].step === 'transfer_confirm') {
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[orderData.index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
            const userUsername = msg.from.username;
            const userFirstName = msg.from.first_name;
            
            const adminMessage = 
                `📢 **НОВЫЙ ЗАКАЗ (Оплата переводом)**\n\n` +
                `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                `**Сумма:** ${selectedItem.price} ${currency}\n` +
                `**Пользователь:** ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                `**ID пользователя:** ${msg.from.id}\n` +
                `**ID игрока MLBB:** ${orderData.playerId}\n` +
                `**Ожидает подтверждения: скриншот был отправлен.**`;

            if (msg.photo) {
                await bot.sendPhoto(adminChatId, msg.photo[msg.photo.length - 1].file_id, {
                    caption: adminMessage,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Подтвердить', callback_data: `confirm_payment_${chatId}` }],
                            [{ text: '❌ Отклонить', callback_data: `decline_payment_${chatId}` }]
                        ]
                    }
                });
                await bot.sendMessage(chatId, '✅ **Ваш скриншот отправлен на проверку.** Мы сообщим вам, как только оплата будет подтверждена!', { parse_mode: 'Markdown' });
                delete waitingForAction[chatId];
            } else {
                await bot.sendMessage(chatId, 'Пожалуйста, отправьте именно скриншот (изображение), а не другой тип файла.');
            }
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
        
            await bot.sendMessage(chatId, 'Отзывы наших клиентов: https://t.me/annurreviews');
        } else if (q.data === 'leave_review') {
            
            await bot.sendMessage(chatId, 'Оставить отзыв вы можете в нашем канале: https://t.me/annurreviews');
        } else if (q.data === 'back_to_start') {
            await editToMainMenu(chatId, messageId);
        } else if (q.data === 'back_to_regions') {
            await editToRegionMenu(chatId, messageId);
        } else if (q.data.startsWith('diamond_')) {
            const selectedItemIndex = q.data.split('_')[1];
            const diamondsData = selectedRegion === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[selectedItemIndex];

            waitingForAction[chatId] = {
                step: 'playerId',
                index: selectedItemIndex,
                region: selectedRegion,
                item: selectedItem
            };

            await bot.sendMessage(chatId, `Вы выбрали **${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}** за **${selectedItem.price}** ${selectedRegion === 'RU' ? '₽' : 'KGS'}. Пожалуйста, отправьте мне ID своего аккаунта MLBB:`, { parse_mode: 'Markdown' });
        
        } else if (q.data.startsWith('pay_transfer_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
            
            waitingForAction[chatId].step = 'transfer_confirm';

            const paymentDetails = 
                `📢 **ВНИМАНИЕ! Перевод будет выполняться в Кыргызстан (страна СНГ).**\n\n` +
                `Будьте внимательны: если оплата не пройдет по независящим от нас причинам, мы не сможем нести за это ответственность.\n` +
                `Спасибо за понимание. С любовью, ANNUR DIAMONDS 💎\n\n` +
                `**Сумма к оплате: ${selectedItem.price} ${currency}**\n\n` +
                `**Реквизиты для оплаты:**\n` +
                `**Получатель:** Аскар.С\n` +
                `**Mbank:** +996707711770 / 4177490184319665\n` +
                `**Банк Компаньон:** +996707711770 (прямой перевод по номеру телефона)\n` +
                `\nПосле оплаты отправьте скриншот чека в этот чат.`;

            await bot.sendMessage(chatId, paymentDetails, { parse_mode: 'Markdown' });

        } else if (q.data.startsWith('pay_crypto_')) {
            const [, , index] = q.data.split('_');
            const orderData = waitingForAction[chatId];
            const diamondsData = orderData.region === 'RU' ? diamondsDataRU : diamondsDataKG;
            const selectedItem = diamondsData[index];
            const currency = selectedRegion === 'RU' ? 'RUB' : 'KGS';

            const userFirstName = q.from.first_name;
            const userUsername = q.from.username;

            try {
                const response = await axios.post('https://api.cryptocloud.plus/v1/invoice/create', {
                    shop_id: CRYPTOCLOUD_SHOP_ID,
                    amount: selectedItem.price,
                    currency: currency,
                    order_id: `order_${Date.now()}_${chatId}`,
                    payload: {
                        chatId: chatId,
                        username: userUsername || userFirstName,
                        playerId: orderData.playerId,
                        item: `${selectedItem.amount} ${currency}`
                    },
                    email: null
                }, {
                    headers: {
                        'Authorization': `Token ${CRYPTOCLOUD_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                });

                const paymentLink = response.data.result.link;
                
                const adminMessage =
                    `📢 **НОВЫЙ ЗАКАЗ**\n\n` +
                    `**Товар:** ${typeof selectedItem.amount === 'number' ? `${selectedItem.amount}💎` : selectedItem.amount}\n` +
                    `**Сумма:** ${selectedItem.price} ${currency}\n` +
                    `**Пользователь:** ${userUsername ? `@${userUsername}` : userFirstName}\n` +
                    `**ID пользователя:** ${q.from.id}\n` +
                    `**ID игрока MLBB:** ${orderData.playerId}`;
                
                await bot.sendMessage(adminChatId, adminMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${q.from.id}` }]
                        ]
                    }
                });

                await bot.sendMessage(
                    chatId,
                    `К оплате **${selectedItem.price} ${currency}**.\n\n` +
                    `Оплата криптовалютой через CryptoCloud.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Оплатить ✅', url: paymentLink }],
                                [{ text: 'Назад', callback_data: 'back_to_regions' }]
                            ]
                        }
                    }
                );
            } catch (e) {
                console.error('CryptoCloud API error:', e.response ? e.response.data : e.message);
                if (e.response) {
                    console.log('CryptoCloud detailed error:', e.response.data);
                }
                await bot.sendMessage(chatId, 'К сожалению, произошла ошибка при создании платежа. Попробуйте еще раз.');
            }
            
        } else if (q.data.startsWith('confirm_payment_')) {
            const userIdToConfirm = q.data.split('_')[2];
            await bot.sendMessage(userIdToConfirm, `✅ **Ваша оплата подтверждена!** Мы пополним ваш аккаунт в ближайшее время. Спасибо за покупку!`, { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, 'Подтверждение отправлено пользователю.');

            const usersCollection = db.collection('users');
            const user = await usersCollection.findOne({ chatId: parseInt(userIdToConfirm) });
            let purchases = user ? user.purchases : 0;
            purchases++;

            await usersCollection.updateOne(
                { chatId: parseInt(userIdToConfirm) },
                { $set: { purchases: purchases, lastPurchase: new Date() } },
                { upsert: true }
            );

            if (purchases % 5 === 0) {
                await bot.sendMessage(parseInt(userIdToConfirm), `🎉 **Поздравляем!** 🎉 Вы совершили ${purchases} покупок и получаете бонус — **50 бонусных алмазов!**`, { parse_mode: 'Markdown' });
            }

        
            await bot.sendMessage(chatId, 'Оплата подтверждена. Теперь вы можете пополнить счет клиента и нажать "Заказ выполнен".', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Заказ выполнен', callback_data: `complete_order_${userIdToConfirm}` }]
                    ]
                }
            });

        } else if (q.data.startsWith('decline_payment_')) {
            const userIdToDecline = q.data.split('_')[2];
            await bot.sendMessage(userIdToDecline, '❌ **Ваша оплата отклонена.** Пожалуйста, проверьте правильность платежа и повторите попытку.', { parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, 'Отказ отправлен пользователю.');
        } else if (q.data.startsWith('complete_order_')) {
            const userIdToComplete = q.data.split('_')[2];
            await bot.sendMessage(userIdToComplete, `🎉 **Ваш заказ выполнен!** 🎉\n\nПожалуйста, проверьте баланс своего аккаунта в игре. Если вам все понравилось, будем рады вашему отзыву.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Оставить отзыв ❤️', url: 'https://t.me/annurreviews' }]
                    ]
                }
            });
            await bot.sendMessage(chatId, 'Сообщение о выполнении заказа отправлено пользователю.');
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
                    
                    { text: 'Отзывы 💖', url: 'https://t.me/annurreviews' }
                ],
                
                [{ text: 'Оставить отзыв 💌', url: 'https://t.me/annurreviews' }]
            ]
        }
    });
}

async function editToRegionMenu(chatId, messageId) {
    await bot.editMessageText('Выберите регион:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🇷🇺 RU', callback_data: 'region_ru' },
                    { text: '🇰🇬 KG', callback_data: 'region_kg' }
                ],
                [{ text: 'Назад 🔙', callback_data: 'back_to_start' }]
            ],
        },
    });
}

async function editToDiamondsMenu(chatId, messageId) {
    const currency = selectedRegion === 'RU' ? '₽' : 'KGS';
    const diamondsData = selectedRegion === 'RU' ? diamondsDataRU : diamondsDataKG;
    const keyboard = [];
    let currentRow = [];

    diamondsData.forEach((d, index) => {
        const amountText = typeof d.amount === 'number' ? `${d.amount}💎` : d.amount;
        
        currentRow.push({
            text: `${amountText} — ${d.price.toLocaleString('ru-RU')} ${currency}`,
            callback_data: `diamond_${index}`
        });

        if (currentRow.length === 2 || index === diamondsData.length - 1) {
            keyboard.push(currentRow);
            currentRow = [];
        }
    });

    keyboard.push([{ text: 'Назад 🔙', callback_data: 'back_to_regions' }]);

    await bot.editMessageText(`Выберите пакет алмазов (сейчас выбран регион: ${selectedRegion}):`, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
    });
}

async function editToMainMenu(chatId, messageId) {
    await bot.editMessageText('Главное меню:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Купить алмазы 💎', callback_data: 'buy_diamonds' },
                    { text: 'Отзывы 💖', url: 'https://t.me/annurreviews' }
                ],
                [{ text: 'Оставить отзыв 💌', url: 'https://t.me/annurreviews' }]
            ]
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
