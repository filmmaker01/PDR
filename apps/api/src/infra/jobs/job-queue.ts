/** Имена очередей. Единый перечень, чтобы не расходились API и worker. */
export const JOB = {
  notificationsSend: 'notifications.send',
  clubApprove: 'club.approve',
  clubRemove: 'club.remove',
  clubAudit: 'club.audit',
  accessExpire: 'access.expire',
  learningUnlockByDate: 'learning.unlock-by-date',
  examsExpireAttempts: 'exams.expire-attempts',
  appointmentsScheduleReminders: 'appointments.schedule-reminders',
  filesProcess: 'files.process',
  filesCleanup: 'files.cleanup',
  exportRun: 'export.run',
  idempotencyCleanup: 'idempotency.cleanup',
  sessionsCleanup: 'sessions.cleanup',
  backupVerify: 'backup.verify',
  videoPoll: 'video.poll',
  submissionsReleaseStaleClaims: 'submissions.release-stale-claims',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export interface JobPayloads {
  [JOB.notificationsSend]: { notificationId: string };
  [JOB.clubApprove]: { userId: string; telegramUserId: string };
  [JOB.clubRemove]: { userId: string; reason: string };
  [JOB.clubAudit]: Record<string, never>;
  [JOB.accessExpire]: Record<string, never>;
  [JOB.learningUnlockByDate]: Record<string, never>;
  [JOB.examsExpireAttempts]: Record<string, never>;
  [JOB.appointmentsScheduleReminders]: Record<string, never>;
  [JOB.filesProcess]: { fileId: string };
  [JOB.filesCleanup]: Record<string, never>;
  [JOB.exportRun]: { exportId: string };
  [JOB.idempotencyCleanup]: Record<string, never>;
  [JOB.sessionsCleanup]: Record<string, never>;
  [JOB.backupVerify]: Record<string, never>;
  [JOB.videoPoll]: { videoAssetId: string };
  [JOB.submissionsReleaseStaleClaims]: Record<string, never>;
}
