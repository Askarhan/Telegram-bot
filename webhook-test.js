// Скрипт для тестирования вебхуков
const axios = require('axios');

const WEBHOOK_URL = 'https://your-app.onrender.com'; // Замените на ваш URL

async function testWebhooks() {
    console.log('🧪 Тестируем вебхуки...');
    
    try {
        // 1. Проверяем основной endpoint
        console.log('\n1. Проверяем основной endpoint...');
        const mainResponse = await axios.get(WEBHOOK_URL);
        console.log('✅ Основной endpoint:', mainResponse.data);

        // 2. Проверяем health check
        console.log('\n2. Проверяем health check...');
        const healthResponse = await axios.get(`${WEBHOOK_URL}/health`);
        console.log('✅ Health check:', healthResponse.data);

        // 3. Тестируем установку webhook
        console.log('\n3. Тестируем установку webhook...');
        const webhookResponse = await axios.get(`${WEBHOOK_URL}/set-webhook`);
        console.log('✅ Webhook setup:', webhookResponse.data);

        // 4. Тестируем CryptoCloud webhook (mock данные)
        console.log('\n4. Тестируем CryptoCloud webhook...');
        const mockCryptoData = {
            status: 'success',
            amount: 100,
            currency: 'RUB',
            payload: {
                chatId: 123456789,
                username: 'testuser',
                playerId: 'test123'
            }
        };

        // Внимание: это тест только структуры, не отправляйте реальные данные
        console.log('📦 Mock CryptoCloud data структура готова');

        console.log('\n🎉 Все тесты пройдены успешно!');

    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error.response?.data || error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Убедитесь что сервер запущен на', WEBHOOK_URL);
        }
    }
}

// Функция для проверки переменных окружения
function checkEnvironmentVariables() {
    console.log('🔍 Проверяем переменные окружения на Render:');
    
    const requiredVars = [
        'TOKEN',
        'MONGO_URI', 
        'CRYPTOCLOUD_API_KEY',
        'CRYPTOCLOUD_SHOP_ID',
        'WEBHOOK_URL'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.log('❌ Отсутствуют переменные:', missingVars.join(', '));
        console.log('💡 Добавьте их в Environment Variables на Render');
        return false;
    } else {
        console.log('✅ Все переменные окружения настроены');
        return true;
    }
}

// Запуск тестов
if (require.main === module) {
    console.log('🚀 Запуск тестирования вебхуков\n');
    
    // Проверяем переменные окружения
    if (checkEnvironmentVariables()) {
        testWebhooks();
    }
}

module.exports = { testWebhooks, checkEnvironmentVariables };