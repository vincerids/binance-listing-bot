require('dotenv').config()
const axios = require ('axios')

const binanceSpotApi = ('https://api.binance.com/api/v3/exchangeInfo')
const binanceFuturesApi = ('https://fapi.binance.com/fapi/v3/exchangeInfo')
const telegramToken = process.env.TELEGRAM_BOT_TOKEN
const telegramApi = telegramToken
  ? `https://api.telegram.org/bot${telegramToken}`
  : null
const subscribers = new Set(
  process.env.TELEGRAM_CHAT_ID
     ? process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(Boolean)
     : []
)

let telegramUpdateOffset = 0

async function sendTelegramMessage(text) {
  if (!telegramApi) {
     console.log('TELEGRAM_BOT_TOKEN не задан, уведомление пропущено:', text)
     return
  }

  await Promise.all([...subscribers].map(async chatId => {
     try {
       await axios.post(`${telegramApi}/sendMessage`, {
         chat_id: chatId,
         text,
         parse_mode: 'HTML',
       })
     } catch (error) {
       console.log(`Ошибка отправки в Telegram (${chatId}):`, error.response?.data || error.message)
     }
  }))
}

async function handleTelegramUpdates() {
  if (!telegramApi) {
     return
  }

  try {
     const response = await axios.get(`${telegramApi}/getUpdates`, {
       params: {
         offset: telegramUpdateOffset,
         timeout: 20,
       },
       timeout: 25000,
     })

     for (const update of response.data.result || []) {
       telegramUpdateOffset = update.update_id + 1

       const message = update.message
       if (!message?.text) {
         continue
       }

       const chatId = String(message.chat.id)
       const command = message.text.trim().split(/\s+/)[0].toLowerCase()

       if (command === '/start') {
         subscribers.add(chatId)
         await axios.post(`${telegramApi}/sendMessage`, {
           chat_id: chatId,
           text: 'Бот активирован. Я буду присылать новые листинги Binance.',
         })
       } else if (command === '/stop') {
         subscribers.delete(chatId)
         await axios.post(`${telegramApi}/sendMessage`, {
           chat_id: chatId,
           text: 'Уведомления отключены.',
         })
       } else if (command === '/status') {
         await axios.post(`${telegramApi}/sendMessage`, {
           chat_id: chatId,
           text: subscribers.has(chatId)
             ? 'Уведомления включены.'
             : 'Уведомления отключены.',
         })
       }
     }
  } catch (error) {
     if (error.code !== 'ECONNABORTED') {
       console.log('Ошибка Telegram polling:', error.response?.data || error.message)
     }
  }

  setImmediate(handleTelegramUpdates)
}

function createListingChecker({ apiUrl, loadedMessage, listingMessage, errorMessage, fetchExchangeInfo = axios, notify = sendTelegramMessage, logger = console }) {
  const knownTokens = new Set()

  return async function checkListing() {
    let response
    try {
      response = await fetchExchangeInfo(apiUrl)
    } catch (error) {
      logger.log(errorMessage, error)
      return null
    }

    if (!response?.data?.symbols) {
      return
    }

    const tokensList = response.data.symbols.map(symbol => symbol.baseAsset)

    if (knownTokens.size === 0) {
      tokensList.forEach(token => knownTokens.add(token))
      logger.log(loadedMessage)
      return null
    }

    const newListings = [...new Set(tokensList.filter(token => !knownTokens.has(token)))]

    if (newListings.length > 0) {
      const message = listingMessage(newListings)
      logger.log(message)
      await notify(message)
      newListings.forEach(token => knownTokens.add(token))
    }
  }
}

const checkNewSpotListing = createListingChecker({
  apiUrl: binanceSpotApi,
  loadedMessage: 'База спотовых активов загружена. Следим за новинками...',
  listingMessage: tokens => `Новый спотовый листинг: ${tokens.join(', ')}`,
  errorMessage: 'Ошибка: ',
})

const checkNewFuturesListing = createListingChecker({
  apiUrl: binanceFuturesApi,
  loadedMessage: 'База фьючерсных контрактов загружена. Следим за новинками...',
  listingMessage: tokens => `Добавлен новый фьючерсный контракт: ${tokens.join(', ')}`,
  errorMessage: 'Ошибка:',
})

if (require.main === module) {
  if (!telegramApi) {
    console.log('Для Telegram-уведомлений задайте TELEGRAM_BOT_TOKEN.')
  }

  checkNewSpotListing()
  checkNewFuturesListing()
  handleTelegramUpdates()
  setInterval(checkNewSpotListing, 5000)
  setInterval(checkNewFuturesListing, 5000)
}

module.exports = { createListingChecker }
