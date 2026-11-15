import { z } from 'zod';
const schema = z.object({
  ADMIN_PASSWORD_HASH: z.string().min(20),
  ADMIN_SESSION_SECRET: z.string().min(32),
  PTERODACTYL_BASE_URL: z.string().url(),
  PTERODACTYL_CLIENT_API_TOKEN: z.string().min(10),
  PTERODACTYL_SERVER_ID: z.string().min(1),
  DATABASE_URL: z.string().optional()
});

/** Names (never values) of required variables that are missing or malformed. */
export function missingEnv(): string[] {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map(i => String(i.path[0])))].sort();
}

export function isEnvConfigured(): boolean {
  return missingEnv().length === 0;
}

/**
 * Throws when configuration is incomplete. Callers rendering a page must use
 * isEnvConfigured() so a missing variable degrades to an inline error instead
 * of taking down the route.
 */
export function env() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = missingEnv().join(', ');
    throw new Error(`Server configuration is incomplete. Missing or invalid: ${names}.`);
  }
  return parsed.data;
}
