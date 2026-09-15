// Обёртка над собранным обработчиком: сам код лежит в src/vercel.ts и
// собирается `nest build`, потому что NestJS нужен emitDecoratorMetadata,
// которого сборщик функций не даёт.
// eslint-disable-next-line @typescript-eslint/no-require-imports
module.exports = require('../dist/vercel.js').default;
