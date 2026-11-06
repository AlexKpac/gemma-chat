'use strict';

/**
 * Конфигурация Gemma Chat (чистый фронтенд, без бэкенда и без авторизации).
 */
const CONFIG = {
  // Модель OpenRouter
  model: 'google/gemma-3-27b-it',

  // Лимит ответа
  maxTokens: 1000,

  // Ключ OpenRouter, встроенный в репозиторий.
  // Это НЕ шифрование, а обфускация (XOR 0x5A + base64): ключ восстанавливается
  // в браузере, значит его может достать любой посетитель сайта.
  // Реальная защита — лимиты бюджета на стороне OpenRouter.
  // Закодировать новый ключ:
  //   node -e "console.log(Buffer.from([...'sk-or-...'].map(c=>c.charCodeAt(0)^0x5A)).toString('base64'))"
  apiKeyEnc: 'KTF3NSh3LGt3bTlva2lqajg4OWxraTg5am84ajg8Pm5vbjs7Y2xpYjk8bTs+bjw/aDg8Yj8/OGJuP2I+amtpbTg5P2I/bms+aQ==',

  // Явный ключ (не рекомендуется, оставлено для локальных экспериментов)
  apiKey: '',
};

// Переопределения, подставленные хостингом из переменных окружения
// (файл public/env.js генерируется при деплое и не коммитится).
if (typeof ENV !== 'undefined' && ENV) {
  if (ENV.apiKey) { CONFIG.apiKey = ENV.apiKey; CONFIG.apiKeyEnc = ''; }
  if (ENV.model) CONFIG.model = ENV.model;
  if (ENV.maxTokens) CONFIG.maxTokens = ENV.maxTokens;
}
