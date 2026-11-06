'use strict';

/**
 * Конфигурация Gemma Chat (чистый фронтенд, без бэкенда и без авторизации).
 */
const CONFIG = {
  // Базовый URL API (OpenAI-совместимый). SmartBuddy — работает из России без VPN.
  apiBase: 'https://api.smartbuddy.ru/v1',

  // Модель
  model: 'google/gemma-3-27b-it',

  // Лимит ответа
  maxTokens: 1000,

  // Ключ API, встроенный в репозиторий.
  // Это НЕ шифрование, а обфускация (XOR 0x5A + base64): ключ восстанавливается
  // в браузере, значит его может достать любой посетитель сайта.
  // Реальная защита — лимиты бюджета на стороне провайдера.
  // Закодировать новый ключ:
  //   node -e "console.log(Buffer.from([...'ВАШ_КЛЮЧ'].map(c=>c.charCodeAt(0)^0x5A)).toString('base64'))"
  apiKeyEnc: 'a2pjYyZtFwNqLhAeNS0UFg0vKTcJKixuMQo1ODJpKiIKKyBuKDs5NioiCD04Pj5ubm47aTg=',

  // Явный ключ (не рекомендуется, оставлено для локальных экспериментов)
  apiKey: '',
};

// Переопределения, подставленные хостингом из переменных окружения
// (файл public/env.js генерируется при деплое и не коммитится).
if (typeof ENV !== 'undefined' && ENV) {
  if (ENV.apiKey) { CONFIG.apiKey = ENV.apiKey; CONFIG.apiKeyEnc = ''; }
  if (ENV.apiBase) CONFIG.apiBase = ENV.apiBase;
  if (ENV.model) CONFIG.model = ENV.model;
  if (ENV.maxTokens) CONFIG.maxTokens = ENV.maxTokens;
}
