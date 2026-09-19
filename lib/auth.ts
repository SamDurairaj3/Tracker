import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { postgresPool } from '../db/postgres';
import { AUTH_ALLOWED_HOSTS, readAuthSecret } from './auth-config';
import { adminRole, authAccess, engineerRole } from './auth-permissions';

function createAuth(baseURL: string | { allowedHosts: string[]; protocol: 'auto' } = {
  allowedHosts: [...AUTH_ALLOWED_HOSTS],
  protocol: 'auto',
}) {
  const production = process.env.NODE_ENV === 'production';
  return betterAuth({
    database: postgresPool(),
    secret: readAuthSecret(),
    baseURL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limits',
      fields: {
        lastRequest: 'last_request',
      },
    },
    user: {
      modelName: 'auth_users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    advanced: {
      trustedProxyHeaders: true,
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: production,
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
      database: {
        generateId: 'uuid',
        joins: true,
        validateSchema: true,
      },
    },
    plugins: [
      admin({
        ac: authAccess,
        roles: {
          admin: adminRole,
          engineer: engineerRole,
        },
        defaultRole: 'engineer',
        adminRoles: ['admin'],
        bannedUserMessage: 'This account is unavailable. Contact an administrator.',
        schema: {
          user: {
            fields: {
              banReason: 'ban_reason',
              banExpires: 'ban_expires',
            },
          },
          session: {
            fields: {
              impersonatedBy: 'impersonated_by',
            },
          },
        },
      }),
    ],
  });
}

type TrackerAuth = ReturnType<typeof createAuth>;
const authState = globalThis as typeof globalThis & { trackerAuth?: TrackerAuth };

export function getAuth(): TrackerAuth {
  if (!authState.trackerAuth) authState.trackerAuth = createAuth();
  return authState.trackerAuth;
}

/** Server-only instance for trusted local CLI calls that do not carry HTTP headers. */
export function createProvisioningAuth(): TrackerAuth {
  return createAuth('http://localhost:5173');
}

export function clearAuthForTests() {
  delete authState.trackerAuth;
}
