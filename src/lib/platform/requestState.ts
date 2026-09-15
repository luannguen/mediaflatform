import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthPrincipal } from '@/lib/security/auth-guard';

export const requestState = new AsyncLocalStorage<{ requestId: string; principal?: AuthPrincipal }>();
