// Forgot the password and email isn't working? Run on the server:
//
//   docker compose exec carpulse node scripts/reset-login.mjs
//
// Forgets the stored login and signs every browser out, so the next sign-in
// uses AUTH_USERNAME / AUTH_PASSWORD from .env again (see lib/auth.ts).
// Change those in .env first (then `docker compose up -d`) if you don't
// remember them either.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD) {
  console.error(
    "AUTH_USERNAME and AUTH_PASSWORD aren't set, so resetting would leave CarPulse with no sign-in at all.\n" +
      "Set both in .env, run `docker compose up -d`, then run this again."
  );
  process.exit(1);
}

const db = new DatabaseSync(process.env.DATABASE_PATH || join(process.cwd(), "data", "carpulse.db"));
db.exec(`
  delete from settings where key = 'auth_credentials';
  delete from auth_sessions;
  delete from auth_reset_tokens;
`);
db.close();
console.log(`Login reset. Sign in as "${process.env.AUTH_USERNAME}" with the AUTH_PASSWORD from .env.`);
