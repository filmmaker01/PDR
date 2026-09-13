-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('draft', 'submitted', 'in_review', 'accepted', 'returned');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('accepted', 'returned');

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "assignment_key" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'draft',
    "text" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "claimed_by" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "submission_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("submission_id","file_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "review_decision" NOT NULL,
    "comment" TEXT NOT NULL,
    "rubric" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_comments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submissions_status_submitted_at_idx" ON "submissions"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "submissions_enrollment_id_assignment_key_idx" ON "submissions"("enrollment_id", "assignment_key");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_enrollment_id_assignment_key_attempt_no_key" ON "submissions"("enrollment_id", "assignment_key", "attempt_no");

-- CreateIndex
CREATE INDEX "reviews_submission_id_idx" ON "reviews"("submission_id");

-- CreateIndex
CREATE INDEX "review_comments_submission_id_created_at_idx" ON "review_comments"("submission_id", "created_at");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
