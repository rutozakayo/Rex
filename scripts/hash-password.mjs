import { randomBytes, scryptSync } from 'node:crypto';
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/hash-password.mjs "a-long-unique-password" (12+ characters)');
  process.exit(1);
}
const salt = randomBytes(16);
const key = scryptSync(password, salt, 64);
console.log(`scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
