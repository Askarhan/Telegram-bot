// Константы и конфигурация бота
module.exports = {
    // Данные алмазов для России (текущие цены + 10% к себестоимости)
    DIAMONDS_DATA_RU: [
        { amount: 'Недельный алмазный пропуск', price: 217, cost: 197 },
        { amount: 'Сумеречный пропуск', price: 858, cost: 780 },
        { amount: 56, price: 124, cost: 113 },
        { amount: 86, price: 152, cost: 138 },
        { amount: 172, price: 280, cost: 255 },
        { amount: 257, price: 411, cost: 374 },
        { amount: 706, price: 1224, cost: 1113 },
        { amount: 2195, price: 3106, cost: 2823 },
        { amount: 3688, price: 5150, cost: 4682 },
        { amount: 5532, price: 7708, cost: 7007 },
        { amount: 9288, price: 12980, cost: 11800 }
    ],

    // Данные алмазов для Кыргызстана
    DIAMONDS_DATA_KG: [
        { amount: 'Алмазный пропуск (w)', price: 190, cost: 173 },
        { amount: 'Сумеречный пропуск', price: 750, cost: 682 },
        { amount: 56, price: 108, cost: 98 },
        { amount: 86, price: 142, cost: 129 },
        { amount: 172, price: 264, cost: 240 },
        { amount: 257, price: 384, cost: 349 },
        { amount: 706, price: 996, cost: 905 },
        { amount: 2195, price: 2948, cost: 2680 },
        { amount: 3688, price: 4900, cost: 4455 },
        { amount: 5532, price: 7340, cost: 6673 },
        { amount: 9288, price: 12222, cost: 11111 }
    ],

    // Система лояльности
    LOYALTY_LEVELS: {
        0: { name: 'Гость', emoji: '👋', bonus: 0 },
        1: { name: 'Новичок', emoji: '🌱', bonus: 0 },
        5: { name: 'Активный покупатель', emoji: '🔥', bonus: 50 },
        10: { name: 'Постоянный клиент', emoji: '⭐', bonus: 100 },
        20: { name: 'VIP клиент', emoji: '💎', bonus: 150 },
        50: { name: 'Легенда', emoji: '👑', bonus: 250 }
    },

    // Настройки реферальной системы (выгодные для владельца)
    REFERRAL_SETTINGS: {
        REFERRER_BONUS_PERCENT: 3, // 3% от суммы заказа рефереру (от вашей прибыли)
        REFERRED_DISCOUNT_PERCENT: 5, // 5% скидка для приглашенного
        MIN_ORDER_FOR_REFERRAL: 100, // Минимальная сумма заказа для активации реферальной программы
        MAX_REFERRAL_BONUS: 300, // Максимальный бонус за один заказ
        REFERRER_LEVEL_MULTIPLIER: {
            5: 1.2,  // +20% к бонусу для постоянных клиентов
            10: 1.5, // +50% к бонусу для VIP
            20: 2.0  // x2 к бонусу для легенд
        }
    },

    // Настройки промокодов
    PROMO_SETTINGS: {
        DEFAULT_DISCOUNT: 5, // 5% скидка по умолчанию
        MAX_DISCOUNT: 15,    // Максимальная скидка 15%
        VIP_DISCOUNT: 10,    // Специальная скидка для VIP
        FIRST_ORDER_DISCOUNT: 7 // Скидка для первого заказа
    },

    // Эмодзи и сообщения
    EMOJIS: {
        DIAMOND: '💎',
        MONEY: '💰',
        FIRE: '🔥',
        STAR: '⭐',
        CROWN: '👑',
        SUCCESS: '✅',
        ERROR: '❌',
        WARNING: '⚠️',
        INFO: 'ℹ️'
    },

    // Лимиты и ограничения
    LIMITS: {
        MAX_USERNAME_LENGTH: 32,
        MAX_PLAYER_ID_LENGTH: 20,
        MIN_PLAYER_ID_LENGTH: 6,
        MAX_PROMO_USES: 100,
        MAX_ORDERS_PER_DAY: 10
    }
};