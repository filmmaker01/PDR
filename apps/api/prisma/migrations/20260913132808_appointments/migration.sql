-- CreateEnum
CREATE TYPE "appointment_kind" AS ENUM ('inspection', 'repair', 'delivery', 'other');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('planned', 'confirmed', 'done', 'cancelled', 'no_show');

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID,
    "client_id" UUID,
    "assignee_member_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "kind" "appointment_kind" NOT NULL DEFAULT 'repair',
    "status" "appointment_status" NOT NULL DEFAULT 'planned',
    "allow_overlap" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "note" TEXT,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_workspace_id_starts_at_idx" ON "appointments"("workspace_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_workspace_id_assignee_member_id_starts_at_idx" ON "appointments"("workspace_id", "assignee_member_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_workspace_id_order_id_idx" ON "appointments"("workspace_id", "order_id");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_order_id_fkey" FOREIGN KEY ("workspace_id", "order_id") REFERENCES "orders"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_client_id_fkey" FOREIGN KEY ("workspace_id", "client_id") REFERENCES "clients"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_assignee_member_id_fkey" FOREIGN KEY ("workspace_id", "assignee_member_id") REFERENCES "workspace_members"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
