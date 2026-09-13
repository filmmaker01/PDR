-- CreateEnum
CREATE TYPE "estimate_status" AS ENUM ('draft', 'sent', 'agreed', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "estimate_item_kind" AS ENUM ('damage', 'disassembly', 'extra');

-- CreateEnum
CREATE TYPE "discount_kind" AS ENUM ('none', 'percent', 'fixed');

-- CreateEnum
CREATE TYPE "price_unit" AS ENUM ('per_item', 'per_dent', 'per_hour');

-- CreateEnum
CREATE TYPE "material" AS ENUM ('steel', 'aluminum', 'other');

-- CreateEnum
CREATE TYPE "access_difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "estimate_item_kind" NOT NULL DEFAULT 'damage',
    "title" TEXT NOT NULL,
    "panel_code" TEXT,
    "damage_type" TEXT,
    "size_class" TEXT,
    "unit_price_minor" BIGINT NOT NULL,
    "unit" "price_unit" NOT NULL DEFAULT 'per_item',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "estimate_status" NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_kind" "discount_kind" NOT NULL DEFAULT 'none',
    "discount_value" INTEGER NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "note_for_client" TEXT,
    "internal_note" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "agreed_at" TIMESTAMPTZ(6),
    "agreed_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "estimate_item_kind" NOT NULL DEFAULT 'damage',
    "title" TEXT NOT NULL,
    "panel_code" TEXT,
    "damage_type" TEXT,
    "size_class" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "material" "material",
    "access_difficulty" "access_difficulty",
    "on_edge" BOOLEAN NOT NULL DEFAULT false,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "price_list_item_id" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_list_items_workspace_id_is_active_position_idx" ON "price_list_items"("workspace_id", "is_active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_workspace_id_id_key" ON "price_list_items"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "estimates_workspace_id_order_id_idx" ON "estimates"("workspace_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_order_id_version_no_key" ON "estimates"("order_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_workspace_id_id_key" ON "estimates"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "estimate_items_estimate_id_position_idx" ON "estimate_items"("estimate_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_items_workspace_id_id_key" ON "estimate_items"("workspace_id", "id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_agreed_estimate_id_fkey" FOREIGN KEY ("workspace_id", "agreed_estimate_id") REFERENCES "estimates"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_agreed_by_fkey" FOREIGN KEY ("agreed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_workspace_id_estimate_id_fkey" FOREIGN KEY ("workspace_id", "estimate_id") REFERENCES "estimates"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_workspace_id_price_list_item_id_fkey" FOREIGN KEY ("workspace_id", "price_list_item_id") REFERENCES "price_list_items"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
