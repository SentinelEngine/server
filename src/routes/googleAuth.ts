/**
 * googleAuth.ts — Google OAuth 2.0 routes for CloudCost Lens.
 *
 * Flow:
 *   GET /auth/google           → redirects browser to Google consent screen
 *   GET /auth/google/callback  → exchanges code → upserts user → issues JWT
 *                               → redirects to vscode://cloudcostlens.cloudcost-lens/auth?token=...
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
      return reply.code(503).send({
        error: 'Google OAuth not configured',
        hint:  'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
      });
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
          `vscode://cloudcostlens.cloudcost-lens/auth?error=${encodeURIComponent(error ?? 'access_denied')}`,
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
        const vsCodeUri = `vscode://cloudcostlens.cloudcost-lens/auth?token=${encodeURIComponent(jwtToken)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.displayName ?? '')}`;
        return reply.redirect(vsCodeUri);

      } catch (err: any) {
        fastify.log.error({ err: err.message }, 'Google OAuth callback failed');
        return reply.redirect(
          `vscode://cloudcostlens.cloudcost-lens/auth?error=${encodeURIComponent('auth_failed')}`,
        );
      }
    },
  );
};
