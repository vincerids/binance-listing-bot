const assert = require('node:assert/strict')
const test = require('node:test')
const { createListingChecker } = require('../binance-new-listings')

function createResponse(...baseAssets) {
  return {
    data: {
      symbols: baseAssets.map(baseAsset => ({ baseAsset })),
    },
  }
}

test('загружает исходные активы и уведомляет только о новых, без дублей', async () => {
  const responses = [
    createResponse('BTC', 'ETH'),
    createResponse('BTC', 'ETH', 'SOL', 'SOL'),
    createResponse('BTC', 'ETH', 'SOL'),
  ]
  const notifications = []
  const logs = []
  const checkListing = createListingChecker({
    apiUrl: 'test://exchange-info',
    fetchExchangeInfo: async () => responses.shift(),
    notify: async message => notifications.push(message),
    logger: { log: message => logs.push(message) },
    loadedMessage: 'initial load',
    listingMessage: tokens => `New listings: ${tokens.join(', ')}`,
    errorMessage: 'API error',
  })

  await checkListing()
  await checkListing()
  await checkListing()

  assert.deepEqual(notifications, ['New listings: SOL'])
  assert.deepEqual(logs, ['initial load', 'New listings: SOL'])
})

test('ошибка API не загружает пустую базу и проверка может продолжиться', async () => {
  let shouldFail = true
  const notifications = []
  const checkListing = createListingChecker({
    apiUrl: 'test://exchange-info',
    fetchExchangeInfo: async () => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('offline')
      }
      return createResponse('BTC')
    },
    notify: async message => notifications.push(message),
    logger: { log() {} },
    loadedMessage: 'initial load',
    listingMessage: tokens => `New listings: ${tokens.join(', ')}`,
    errorMessage: 'API error',
  })

  await checkListing()
  await checkListing()
  await checkListing()

  assert.deepEqual(notifications, [])
})
