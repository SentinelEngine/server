/**
 * googleAuth.ts — Google OAuth 2.0 routes for CloudCost Lens.
 *
 * Flow:
 *   GET /auth/google           → redirects browser to Google consent screen
 *   GET /auth/google/callback  → exchanges code → upserts user → issues JWT
 *                               → redirects to vscode://cloudcostgauge.cloud-cost-gauge/auth?token=...
 *
 * No Passport.js dependency — uses googleapis directly.
 */
import type { FastifyPluginAsync } from 'fastify';
import { google }                    from 'googleapis';
import { config }                    from '../config.js';
import { db }                        from '../db/index.js';
import { users }                     from '../db/schema.js';
import { eq }                        from 'drizzle-orm';

// ── OAuth2 client ─────────────────────────────────────────────────────────────

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_CALLBACK_URL,
  );
}

const SCOPES = ['openid', 'profile', 'email'];

// ── Routes ────────────────────────────────────────────────────────────────────

export const googleAuthRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /auth/google ───────────────────────────────────────────────────────
  // Redirects the user's browser to Google's OAuth consent page.
  fastify.get('/auth/google', async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      return reply
        .code(503)
        .type('text/html')
        .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Google OAuth Not Configured</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { max-width: 520px; width: calc(100% - 32px); background: rgba(15,23,42,0.96); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; box-shadow: 0 30px 80px rgba(15,23,42,0.45); padding: 32px; }
    h1 { margin: 0 0 18px; font-size: 1.9rem; color: #f8fafc; }
    p { margin: 0 0 16px; line-height: 1.75; color: #cbd5e1; }
    code { display: inline-block; padding: 4px 8px; border-radius: 8px; background: rgba(148,163,184,0.12); color: #f8fafc; }
    .badge { display: inline-flex; align-items: center; gap: 0.5rem; margin-bottom: 20px; padding: 10px 14px; border-radius: 999px; background: rgba(96,165,250,0.12); color: #bfdbfe; font-size: 0.86rem; }
    .list { margin: 0; padding-left: 18px; color: #e2e8f0; }
    .list li { margin-bottom: 10px; }
    a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Google OAuth is not configured</div>
    <h1>Backend authorization is incomplete</h1>
    <p>The local CloudGauge backend is running, but it is missing Google OAuth credentials.</p>
    <p>Please open <code>server/.env</code> and set both:</p>
    <ul class="list">
      <li><code>GOOGLE_CLIENT_ID</code></li>
      <li><code>GOOGLE_CLIENT_SECRET</code></li>
    </ul>
    <p>Then restart the backend and retry sign in from the extension.</p>
    <p>If you need a callback URL, use:</p>
    <p><code>http://localhost:3001/auth/google/callback</code></p>
  </div>
</body>
</html>
`);
    }

    // ── DEV BYPASS ─────────────────────────────────────────────────────────────
    if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_ID.includes('mock.apps.googleusercontent.com')) {
      fastify.log.warn('Using mock test credentials - bypassing real Google OAuth directly to Panel Demo account.');
      
      const [user] = await db
        .insert(users)
        .values({
          googleId:    'panel-demo-mock-id-999',
          email:       'demo@cloudgauge.local',
          displayName: 'Panel Evaluator',
          avatarUrl:   'https://www.gravatar.com/avatar/2c7d99fe281ecd3bcd65ab915bac6dd5?s=250',
        })
        .onConflictDoUpdate({
          target: users.googleId,
          set: {
            email:       'demo@cloudgauge.local',
            displayName: 'Panel Evaluator',
          },
        })
        .returning();

      const jwtToken = fastify.jwt.sign(
        { sub: user.id, email: user.email, name: user.displayName, role: 'user' },
        { expiresIn: '7d' }
      );

      return reply.redirect(`vscode://cloudcostguard.cloud-cost-guard/auth?token=${encodeURIComponent(jwtToken)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.displayName ?? '')}`);
    }

    const oauth2 = makeOAuth2Client();
    const url    = oauth2.generateAuthUrl({
      access_type: 'offline',
      scope:       SCOPES,
      prompt:      'select_account',
    });

    return reply.redirect(url);
  });

  // ── GET /auth/google/callback ──────────────────────────────────────────────
  // Google redirects here after the user approves.
  fastify.get<{ Querystring: { code?: string; error?: string } }>(
    '/auth/google/callback',
    async (request, reply) => {
      const { code, error } = request.query;

      if (error || !code) {
        fastify.log.warn({ error }, 'Google OAuth denied or cancelled');
        return reply.redirect(
          `vscode://cloudcostguard.cloud-cost-guard/auth?error=${encodeURIComponent(error ?? 'access_denied')}`,
        );
      }

      try {
        // Exchange code for tokens
        const oauth2     = makeOAuth2Client();
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);

        // Fetch user profile
        const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
        const { data: profile } = await oauth2Api.userinfo.get();

        if (!profile.id || !profile.email) {
          throw new Error('Incomplete profile returned from Google');
        }

        // Upsert user into DB
        const [user] = await db
          .insert(users)
          .values({
            googleId:    profile.id,
            email:       profile.email,
            displayName: profile.name ?? null,
            avatarUrl:   profile.picture ?? null,
          })
          .onConflictDoUpdate({
            target: users.googleId,
            set: {
              email:       profile.email,
              displayName: profile.name ?? null,
              avatarUrl:   profile.picture ?? null,
            },
          })
          .returning();

        if (!user) {
          throw new Error('Failed to upsert user record');
        }

        // Sign a JWT with the persistent user ID
        const jwtToken = fastify.jwt.sign(
          {
            sub:   user.id,
            email: user.email,
            name:  user.displayName,
            role:  'user',
          },
          { expiresIn: '7d' },
        );

        fastify.log.info({ userId: user.id, email: user.email }, 'Google OAuth success');

        // Redirect back to VS Code extension via deep link
        const vsCodeUri = `vscode://cloudcostguard.cloud-cost-guard/auth?token=${encodeURIComponent(jwtToken)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.displayName ?? '')}`;
        return reply.redirect(vsCodeUri);

      } catch (err: any) {
        const errMsg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ err: err, errMsg }, 'Google OAuth callback failed');
        return reply.redirect(
          `vscode://cloudcostguard.cloud-cost-guard/auth?error=${encodeURIComponent(`auth_failed: ${errMsg}`)}`,
        );
      }
    },
  );
};
