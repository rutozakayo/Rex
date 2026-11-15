import { z } from 'zod';

/**
 * Website authentication config. This is the only configuration the dashboard
 * needs to boot and log in — panel credentials are supplied later through the
 * connection flow, so login must never depend on Pterodactyl variables.
 */
const authSchema = z.object({
  ADMIN_PASSWORD_HASH: z.string().min(20),
  ADMIN_SESSION_SECRET: z.string().min(32)
});

/** Legacy single-panel configuration, still honoured as a fallback. */
const legacyPanelSchema = z.object({
  PTERODACTYL_BASE_URL: z.string().url(),
  PTERODACTYL_CLIENT_API_TOKEN: z.string().min(10),
  PTERODACTYL_SERVER_ID: z.string().min(1)
});

function names(issues: { path: (string | number)[] }[]): string[] {
  return [...new Set(issues.map(i => String(i.path[0])))].sort();
}

export function authMissing(): string[] {
  const parsed = authSchema.safeParse(process.env);
  return parsed.success ? [] : names(parsed.error.issues);
}

export function isEnvConfigured(): boolean {
  return authMissing().length === 0;
}

/** Throws with the offending variable names when authentication is unconfigured. */
export function authConfig() {
  const parsed = authSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Server configuration is incomplete. Missing or invalid: ${names(parsed.error.issues).join(', ')}.`);
  }
  return parsed.data;
}

/** Full diagnostic list: auth variables plus any partially set legacy panel variables. */
export function missingEnv(): string[] {
  const out = new Set(authMissing());
  const legacy = legacyPanelSchema.safeParse(process.env);
  if (!legacy.success) {
    const set = ['PTERODACTYL_BASE_URL', 'PTERODACTYL_CLIENT_API_TOKEN', 'PTERODACTYL_SERVER_ID']
      .filter(k => Boolean(process.env[k]));
    // Only report legacy variables when the operator has started using them.
    if (set.length > 0) names(legacy.error.issues).forEach(n => out.add(n));
  }
  return [...out].sort();
}

export function legacyPanelConfig() {
  const parsed = legacyPanelSchema.safeParse(process.env);
  return parsed.success ? parsed.data : null;
}
