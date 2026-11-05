'use strict';

/**
 * Конфигурация Gemma Chat (чистый фронтенд, без бэкенда).
 *
 * Пользователи задаются как «логин → SHA-256 хэш от строки "логин:пароль"».
 * Пароль в открытом виде здесь не хранится и в браузер не попадает.
 *
 * Посчитать хэш для нового пользователя (в терминале):
 *   node -e "console.log(require('crypto').createHash('sha256').update('ЛОГИН:ПАРОЛЬ').digest('hex'))"
 * или в консоли браузера:
 *   crypto.subtle.digest('SHA-256', new TextEncoder().encode('ЛОГИН:ПАРОЛЬ'))
 *     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))
 */
const CONFIG = {
  users: {
    // логин: sha256("логин:пароль")  — по умолчанию admin / admin123 (поменяйте!)
    admin: 'bf6b5bdb74c79ece9fc0ad0ac9fb0359f9555d4f35a83b2e6ec69ae99e09603d',
  },

  // Модель OpenRouter
  model: 'google/gemma-3-27b-it',

  // Лимит ответа
  maxTokens: 1000,

  // Ключ OpenRouter, встроенный на хостинге (см. README: генерируется env.js
  // из переменной окружения OPENROUTER_API_KEY при деплое).
  // Если ключ задан здесь — экран ввода ключа не показывается.
  apiKey: '',
};

// Переопределения, подставленные хостингом из переменных окружения
// (файл public/env.js генерируется при деплое и не коммитится).
if (typeof ENV !== 'undefined' && ENV) {
  if (ENV.apiKey) CONFIG.apiKey = ENV.apiKey;
  if (ENV.model) CONFIG.model = ENV.model;
  if (ENV.maxTokens) CONFIG.maxTokens = ENV.maxTokens;
}
