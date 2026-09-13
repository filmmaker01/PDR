import { ApiClient, createLocalTokenStore } from '@pdr/api-client';

const baseUrl = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/v1`;

export const tokenStore = createLocalTokenStore('pdr.admin');

let authFailureHandler: (() => void) | null = null;
export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

export const api = new ApiClient({
  baseUrl,
  tokens: tokenStore,
  onAuthFailure: () => authFailureHandler?.(),
});
