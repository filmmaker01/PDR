import { Injectable } from '@nestjs/common';

/**
 * Источники фактов выполнения.
 *
 * Модули практики и экзаменов подключают сюда свои выборки. Пока они не
 * подключены, соответствующие требования считаются отсутствующими, и сервис
 * прогресса остаётся рабочим — это позволяет вводить модули по одному,
 * не переписывая правила открытия этапов.
 */
export type KeysProvider = (enrollmentId: string) => Promise<string[]>;

@Injectable()
export class CompletionFactsRegistry {
  private acceptedAssignments: KeysProvider | null = null;
  private passedExams: KeysProvider | null = null;

  registerAcceptedAssignments(provider: KeysProvider): void {
    this.acceptedAssignments = provider;
  }

  registerPassedExams(provider: KeysProvider): void {
    this.passedExams = provider;
  }

  async getAcceptedAssignmentKeys(enrollmentId: string): Promise<string[]> {
    return this.acceptedAssignments ? this.acceptedAssignments(enrollmentId) : [];
  }

  async getPassedExamKeys(enrollmentId: string): Promise<string[]> {
    return this.passedExams ? this.passedExams(enrollmentId) : [];
  }

  get hasAssignmentSource(): boolean {
    return this.acceptedAssignments !== null;
  }

  get hasExamSource(): boolean {
    return this.passedExams !== null;
  }
}
