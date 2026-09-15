-- Очередь фоновых задач вместо pg-boss.
CREATE TABLE "job_queue" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "run_at" TIMESTAMPTZ(6) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retry_limit" INTEGER NOT NULL DEFAULT 3,
    "retry_delay_sec" INTEGER NOT NULL DEFAULT 30,
    "singleton_key" TEXT,
    "last_error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_queue_state_run_at_idx" ON "job_queue"("state", "run_at");
CREATE INDEX "job_queue_name_state_idx" ON "job_queue"("name", "state");

-- Ключ уникальности действует только пока задача не доведена до конца:
-- завершённая задача не должна мешать поставить такую же следующий раз.
-- Именно на этом держится расписание: ключ задачи по расписанию содержит
-- минуту запуска, поэтому повторный tick в ту же минуту дубль не создаёт.
CREATE UNIQUE INDEX "job_queue_singleton_active_idx"
    ON "job_queue"("name", "singleton_key")
    WHERE "singleton_key" IS NOT NULL AND "state" IN ('pending', 'active');
