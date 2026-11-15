import { z } from 'zod';

const authSchema = z.object({
  ADMIN_PASSWORD_HASH: z.string().min(20),
  ADMIN_SESSION_SECRET: z.string().min(32),
});

const schema = authSchema.extend({
  PTERODACTYL_BASE_URL: z.string().url(),
  PTERODACTYL_CLIENT_API_TOKEN: z.string().min(10),
  PTERODACTYL_SERVER_ID: z.string().min(1),
  DATABASE_URL: z.string().optional(),
});

export function authEnv() {
  const parsed = authSchema.safeParse(process.env);
  if (!parsed.success) throw new Error('Authentication configuration is incomplete. Check required environment variables.');
  return parsed.data;
}

export function env() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error('Server configuration is incomplete. Check required environment variables.');
  return parsed.data;
}
