-- Демо-аккаунты staging: ключ входа без Telegram. В production колонка остаётся пустой.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "demo_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_demo_key_key" ON "users"("demo_key");

