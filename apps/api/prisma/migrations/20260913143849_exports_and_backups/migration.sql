-- CreateEnum
CREATE TYPE "export_kind" AS ENUM ('crm_full', 'crm_clients', 'crm_orders', 'crm_payments', 'learning_students', 'learning_progress', 'audit');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "exports" (
    "id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "workspace_id" UUID,
    "kind" "export_kind" NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'queued',
    "params" JSONB NOT NULL DEFAULT '{}',
    "file_id" UUID,
    "row_count" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exports_requested_by_created_at_idx" ON "exports"("requested_by", "created_at");

-- CreateIndex
CREATE INDEX "exports_workspace_id_created_at_idx" ON "exports"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "exports_status_created_at_idx" ON "exports"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_runs_created_at_idx" ON "backup_runs"("created_at");

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
