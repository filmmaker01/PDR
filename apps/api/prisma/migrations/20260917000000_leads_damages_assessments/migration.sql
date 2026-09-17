-- Обращения, повреждения на схеме кузова, оценки ремонта и разметка фотографий.
--
-- Все новые поля существующих таблиц допускают NULL: заказы, клиенты,
-- автомобили и календарь продолжают работать без изменений.

-- CreateEnum
CREATE TYPE "lead_source" AS ENUM ('online', 'offline');

-- CreateEnum
CREATE TYPE "lead_channel" AS ENUM ('telegram', 'whatsapp', 'vk', 'call', 'in_person', 'other');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('new', 'estimated', 'awaiting_decision', 'callback', 'scheduled', 'rejected');

-- CreateEnum
CREATE TYPE "damage_price_source" AS ENUM ('manual', 'params', 'ai');

-- CreateEnum
CREATE TYPE "assessment_method" AS ENUM ('manual', 'params', 'ai');

-- AlterTable: счётчик номеров обращений рядом со счётчиком заказов.
ALTER TABLE "workspaces" ADD COLUMN "lead_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "client_id" UUID,
    "vehicle_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_extra" TEXT,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "vehicle_plate" TEXT,
    "vehicle_year" INTEGER,
    "vehicle_color" TEXT,
    "source" "lead_source" NOT NULL DEFAULT 'offline',
    "channel" "lead_channel",
    "status" "lead_status" NOT NULL DEFAULT 'new',
    "comment" TEXT,
    "estimate_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "next_contact_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "assignee_member_id" UUID,
    "converted_order_id" UUID,
    "converted_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status" "lead_status",
    "to_status" "lead_status" NOT NULL,
    "changed_by" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damages" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID,
    "order_id" UUID,
    "panel_code" TEXT NOT NULL,
    "damage_type" TEXT,
    "size_class" TEXT,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "material" "material",
    "access_difficulty" "access_difficulty",
    "on_edge" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "price_minor" BIGINT,
    "price_source" "damage_price_source",
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "damages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "lead_id" UUID,
    "order_id" UUID,
    "method" "assessment_method" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "suggested_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT,
    "note" TEXT,
    "ai_provider" TEXT,
    "ai_model" TEXT,
    "ai_raw" JSONB,
    "ai_confidence" DOUBLE PRECISION,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "damage_id" UUID,
    "position" INTEGER NOT NULL,
    "panel_code" TEXT,
    "damage_type" TEXT,
    "size_class" TEXT,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "material" "material",
    "access_difficulty" "access_difficulty",
    "on_edge" BOOLEAN NOT NULL DEFAULT false,
    "suggested_unit_price_minor" BIGINT NOT NULL DEFAULT 0,
    "unit_price_minor" BIGINT NOT NULL DEFAULT 0,
    "line_total_minor" BIGINT NOT NULL DEFAULT 0,
    "price_list_item_id" UUID,
    "confidence" DOUBLE PRECISION,
    "comment" TEXT,

    CONSTRAINT "assessment_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable: запись в календарь может относиться к обращению.
ALTER TABLE "appointments" ADD COLUMN "lead_id" UUID;

-- AlterTable: снимок принадлежит заказу либо обращению и может быть привязан
-- к конкретному повреждению. Разметка хранится отдельно от оригинала.
ALTER TABLE "order_photos" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "order_photos" ADD COLUMN "lead_id" UUID;
ALTER TABLE "order_photos" ADD COLUMN "damage_id" UUID;
ALTER TABLE "order_photos" ADD COLUMN "annotation" JSONB;
ALTER TABLE "order_photos" ADD COLUMN "annotation_file_id" UUID;
ALTER TABLE "order_photos" ADD COLUMN "annotated_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspace_id_number_key" ON "leads"("workspace_id", "number");
CREATE UNIQUE INDEX "leads_workspace_id_id_key" ON "leads"("workspace_id", "id");
CREATE INDEX "leads_workspace_id_status_created_at_idx" ON "leads"("workspace_id", "status", "created_at");
CREATE INDEX "leads_workspace_id_next_contact_at_idx" ON "leads"("workspace_id", "next_contact_at");
CREATE INDEX "leads_workspace_id_client_id_idx" ON "leads"("workspace_id", "client_id");

-- CreateIndex
CREATE INDEX "lead_status_history_lead_id_created_at_idx" ON "lead_status_history"("lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "damages_workspace_id_id_key" ON "damages"("workspace_id", "id");
CREATE INDEX "damages_lead_id_position_idx" ON "damages"("lead_id", "position");
CREATE INDEX "damages_order_id_position_idx" ON "damages"("order_id", "position");
CREATE INDEX "damages_workspace_id_panel_code_idx" ON "damages"("workspace_id", "panel_code");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_workspace_id_id_key" ON "assessments"("workspace_id", "id");
CREATE INDEX "assessments_lead_id_created_at_idx" ON "assessments"("lead_id", "created_at");
CREATE INDEX "assessments_order_id_created_at_idx" ON "assessments"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "assessment_items_assessment_id_position_idx" ON "assessment_items"("assessment_id", "position");

-- CreateIndex
CREATE INDEX "appointments_workspace_id_lead_id_idx" ON "appointments"("workspace_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_photos_workspace_id_id_key" ON "order_photos"("workspace_id", "id");
CREATE INDEX "order_photos_lead_id_position_idx" ON "order_photos"("lead_id", "position");
CREATE INDEX "order_photos_damage_id_idx" ON "order_photos"("damage_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_client_id_fkey" FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_vehicle_id_fkey" FOREIGN KEY ("workspace_id", "vehicle_id") REFERENCES "vehicles"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_assignee_member_id_fkey" FOREIGN KEY ("workspace_id", "assignee_member_id") REFERENCES "workspace_members"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_converted_order_id_fkey" FOREIGN KEY ("workspace_id", "converted_order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_workspace_id_lead_id_fkey" FOREIGN KEY ("workspace_id", "lead_id") REFERENCES "leads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_status_history" ADD CONSTRAINT "lead_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "damages" ADD CONSTRAINT "damages_workspace_id_lead_id_fkey" FOREIGN KEY ("workspace_id", "lead_id") REFERENCES "leads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "damages" ADD CONSTRAINT "damages_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "damages" ADD CONSTRAINT "damages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_workspace_id_lead_id_fkey" FOREIGN KEY ("workspace_id", "lead_id") REFERENCES "leads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_workspace_id_assessment_id_fkey" FOREIGN KEY ("workspace_id", "assessment_id") REFERENCES "assessments"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_workspace_id_damage_id_fkey" FOREIGN KEY ("workspace_id", "damage_id") REFERENCES "damages"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "assessment_items" ADD CONSTRAINT "assessment_items_workspace_id_price_list_item_id_fkey" FOREIGN KEY ("workspace_id", "price_list_item_id") REFERENCES "price_list_items"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_lead_id_fkey" FOREIGN KEY ("workspace_id", "lead_id") REFERENCES "leads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_workspace_id_lead_id_fkey" FOREIGN KEY ("workspace_id", "lead_id") REFERENCES "leads"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_workspace_id_damage_id_fkey" FOREIGN KEY ("workspace_id", "damage_id") REFERENCES "damages"("workspace_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_annotation_file_id_fkey" FOREIGN KEY ("annotation_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
