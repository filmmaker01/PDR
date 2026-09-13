export const LAST_WORKSPACE_KEY = 'pdr.miniapp:last-workspace';

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function rememberWorkspace(id: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    /* приватный режим: обойдёмся без запоминания */
  }
}
