# Исправление совместимости с STB браузерами

## Проблема
Приложение выдавало ошибку `SyntaxError: Unexpected token '.'` в STB устройствах из-за использования современного JavaScript синтаксиса (optional chaining `?.`), который не поддерживается старыми браузерами.

## Решение
Добавлена автоматическая транспиляция JavaScript кода с помощью Babel для обеспечения совместимости со старыми браузерами.

### Что было сделано:

1. **Установлены зависимости Babel:**
   - `@babel/core` - основной движок транспиляции
   - `@babel/preset-env` - пресет для транспиляции современного JS
   - `@babel/cli` - командная строка для сборки
   - `@babel/plugin-transform-optional-chaining` - плагин для optional chaining
   - `@babel/plugin-transform-nullish-coalescing-operator` - плагин для nullish coalescing

2. **Создана конфигурация Babel (`babel.config.js`):**
   - Нацелена на старые браузеры (Chrome 49+, Firefox 45+, Safari 9+, IE 11)
   - Включает транспиляцию optional chaining и nullish coalescing
   - Принудительная транспиляция всех современных фич

3. **Обновлен package.json:**
   - Добавлены скрипты `build`, `build:watch`, `serve:built`
   - Скрипт `build` транспилирует исходные файлы в папку `dist/`

4. **Обновлен сервер (server.js):**
   - Автоматическое определение режима (production/development)
   - В production режиме обслуживаются транспилированные файлы из `dist/`
   - В development режиме обслуживаются исходные файлы из `src/`

5. **Обновлен Dockerfile:**
   - Добавлен шаг сборки `npm run build` для транспиляции
   - Сборка происходит автоматически при деплое

6. **Обновлен .gitignore:**
   - Добавлена папка `dist/` в исключения

## Результат
Теперь optional chaining `?.` транспилируется в совместимый код:

**Было:**
```javascript
if (foodData.results?.length) {
  // код
}
```

**Стало:**
```javascript
if ((_foodData$results = foodData.results) !== null && _foodData$results !== void 0 && _foodData$results.length) {
  // код
}
```

## Команды для разработки

```bash
# Транспиляция файлов
npm run build

# Транспиляция с отслеживанием изменений
npm run build:watch

# Запуск сервера с транспилированными файлами
npm run serve:built
```

## Автоматическая сборка
При деплое на Render транспиляция происходит автоматически благодаря обновленному Dockerfile.

## Тестирование совместимости
Для тестирования совместимости со старыми браузерами:
1. Запустите `npm run build`
2. Запустите `npm run serve:built`
3. Откройте приложение в старом браузере или эмуляторе

Теперь приложение должно работать без ошибок `SyntaxError: Unexpected token '.'` в STB устройствах.

## Дополнительные исправления для STB совместимости

### Исправление ошибки "ReferenceError: Can't find variable: google"

Добавлена дополнительная защита от ошибок Google Maps API:

1. **Безопасная проверка Google Maps API:**
   ```javascript
   // Было:
   if (!mockMode && mapCtl.map && google?.maps) {
   
   // Стало:
   if (!mockMode && mapCtl.map && typeof google !== 'undefined' && google && google.maps) {
   ```

2. **Дополнительная проверка после загрузки API:**
   ```javascript
   await loadGoogleMaps(apiKey, cfg.lang);
   if (typeof google === 'undefined' || !google || !google.maps) {
     throw new Error('Google Maps API not available on this device');
   }
   ```

3. **Fallback для инициализации карты:**
   - Если Google Maps API недоступен, используется mock режим
   - Приложение продолжает работать в текстовом режиме
   - Все функции маршрутизации работают через серверный API

4. **Обертывание в try-catch:**
   - Весь код работы с Google Maps API обернут в try-catch блоки
   - Ошибки логируются, но не прерывают работу приложения

5. **Версионирование статических файлов:**
   - Добавлен параметр `?v=2` к main.js для предотвращения кэширования старых файлов
   - STB устройства будут загружать обновленные файлы

### Результат
Теперь приложение:
- ✅ Не выдает ошибки `SyntaxError: Unexpected token '.'`
- ✅ Не выдает ошибки `ReferenceError: Can't find variable: google`
- ✅ Работает в fallback режиме если Google Maps API недоступен
- ✅ Автоматически переключается на текстовый режим на STB устройствах
- ✅ Предотвращает кэширование старых файлов
