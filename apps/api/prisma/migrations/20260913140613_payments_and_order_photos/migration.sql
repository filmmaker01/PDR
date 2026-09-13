-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('payment', 'refund', 'correction');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'card', 'transfer', 'sbp', 'other');

-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('prepayment', 'payment', 'final', 'refund', 'correction');

-- CreateEnum
CREATE TYPE "photo_category" AS ENUM ('before', 'during', 'after', 'document');

-- CreateTable
CREATE TABLE "payment_entries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "payment_kind" NOT NULL DEFAULT 'payment',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "payment_method" NOT NULL DEFAULT 'cash',
    "purpose" "payment_purpose" NOT NULL DEFAULT 'payment',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "corrects_entry_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_photos" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "category" "photo_category" NOT NULL DEFAULT 'before',
    "estimate_item_id" UUID,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_entries_workspace_id_occurred_at_idx" ON "payment_entries"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_entries_order_id_occurred_at_idx" ON "payment_entries"("order_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_entries_workspace_id_id_key" ON "payment_entries"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "order_photos_order_id_category_position_idx" ON "order_photos"("order_id", "category", "position");

-- CreateIndex
CREATE UNIQUE INDEX "order_photos_order_id_file_id_key" ON "order_photos"("order_id", "file_id");

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_workspace_id_corrects_entry_id_fkey" FOREIGN KEY ("workspace_id", "corrects_entry_id") REFERENCES "payment_entries"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_workspace_id_estimate_item_id_fkey" FOREIGN KEY ("workspace_id", "estimate_item_id") REFERENCES "estimate_items"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
