import { z } from 'zod';
import { type PLATFORM_ROLES, type PRODUCTS, type WORKSPACE_ROLES } from '../enums/index.js';

export const miniAppLoginSchema = z.object({
  initData: z.string().min(1).max(4096),
});
export type MiniAppLoginInput = z.infer<typeof miniAppLoginSchema>;

export const widgetLoginSchema = z
  .object({
    id: z.coerce.number().int(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().optional(),
    auth_date: z.coerce.number().int(),
    hash: z.string(),
  })
  .passthrough();
export type WidgetLoginInput = z.infer<typeof widgetLoginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(200) });

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MeProductAccess {
  product: (typeof PRODUCTS)[number];
  courseId: string | null;
  workspaceId: string | null;
  validUntil: string | null;
  status: 'active' | 'expired' | 'revoked' | 'suspended';
}

export interface MeWorkspace {
  id: string;
  name: string;
  role: (typeof WORKSPACE_ROLES)[number];
  memberId: string;
  timezone: string;
  currency: string;
  hasActiveAccess: boolean;
  accessValidUntil: string | null;
}

export interface MeEnrollment {
  id: string;
  courseId: string;
  courseTitle: string;
  cohortId: string;
  cohortTitle: string;
  status: string;
  startedAt: string;
  hasActiveAccess: boolean;
  accessValidUntil: string | null;
}

export interface MeResponse {
  user: {
    id: string;
    telegramUserId: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
    phone: string | null;
    photoUrl: string | null;
    botWriteAllowed: boolean;
    languageCode: string | null;
  };
  platformRoles: (typeof PLATFORM_ROLES)[number][];
  workspaces: MeWorkspace[];
  enrollments: MeEnrollment[];
  products: MeProductAccess[];
  club: { hasAccess: boolean; validUntil: string | null; status: string };
  notifications: Record<string, boolean | number>;
}

export const updateMeSchema = z.object({
  phone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  languageCode: z.string().trim().max(8).nullable().optional(),
});
