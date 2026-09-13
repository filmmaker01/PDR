process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/pdr_test?schema=public';
process.env.SESSION_JWT_SECRET ??= 'test-secret-test-secret-test-secret-test';
process.env.PUBLIC_API_URL ??= 'http://localhost:3000';
process.env.MINIAPP_URL ??= 'http://localhost:5173';
process.env.ADMIN_URL ??= 'http://localhost:5174';
process.env.TELEGRAM_ENABLED ??= 'false';
process.env.STORAGE_DRIVER ??= 'local';
process.env.STORAGE_LOCAL_DIR ??= './storage-test';
process.env.VIDEO_PROVIDER ??= 'mock';
process.env.LOG_LEVEL ??= 'error';
