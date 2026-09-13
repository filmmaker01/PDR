-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('new', 'pending_approval', 'scheduled', 'in_progress', 'ready', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('unpaid', 'partial', 'paid', 'overpaid');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_extra" TEXT,
    "telegram_username" TEXT,
    "telegram_user_id" BIGINT,
    "source" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived_at" TIMESTAMPTZ(6),
    "anonymized_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "plate" TEXT,
    "vin" TEXT,
    "body_type" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "client_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "assignee_member_id" UUID,
    "status" "order_status" NOT NULL DEFAULT 'new',
    "payment_status" "payment_status" NOT NULL DEFAULT 'unpaid',
    "agreed_estimate_id" UUID,
    "agreed_total_minor" BIGINT,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "title" TEXT,
    "damage_summary" TEXT,
    "internal_notes" TEXT,
    "client_notes" TEXT,
    "scheduled_start_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "changed_by" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_workspace_id_phone_idx" ON "clients"("workspace_id", "phone");

-- CreateIndex
CREATE INDEX "clients_workspace_id_archived_at_idx" ON "clients"("workspace_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "clients_workspace_id_id_key" ON "clients"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "vehicles_workspace_id_plate_idx" ON "vehicles"("workspace_id", "plate");

-- CreateIndex
CREATE INDEX "vehicles_workspace_id_client_id_idx" ON "vehicles"("workspace_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_workspace_id_id_key" ON "vehicles"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "orders_workspace_id_status_idx" ON "orders"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "orders_workspace_id_assignee_member_id_status_idx" ON "orders"("workspace_id", "assignee_member_id", "status");

-- CreateIndex
CREATE INDEX "orders_workspace_id_client_id_idx" ON "orders"("workspace_id", "client_id");

-- CreateIndex
CREATE INDEX "orders_workspace_id_vehicle_id_idx" ON "orders"("workspace_id", "vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_number_key" ON "orders"("workspace_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_id_key" ON "orders"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_workspace_id_client_id_fkey" FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_client_id_fkey" FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_vehicle_id_fkey" FOREIGN KEY ("workspace_id", "vehicle_id") REFERENCES "vehicles"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_assignee_member_id_fkey" FOREIGN KEY ("workspace_id", "assignee_member_id") REFERENCES "workspace_members"("workspace_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
