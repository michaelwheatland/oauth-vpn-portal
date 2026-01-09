import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import Database from 'better-sqlite3'
import { Pool } from 'pg'
import { env } from './env'

type OAuthProfile = Record<string, unknown>

type VpnConfig = {
  traffic_limit_gb?: number
  data_limit_reset_strategy?: string
  expiry_date?: string | number | null
  proxies?: string[]
  default_proxy?: string
}

const getClaim = <T>(profile: OAuthProfile, key: string): T | undefined => {
  const rootValue = profile[key]
  if (typeof rootValue !== 'undefined') {
    return rootValue as T
  }
  const vpn = profile.vpn
  if (vpn && typeof vpn === 'object' && key in vpn) {
    return (vpn as Record<string, unknown>)[key] as T
  }
  return undefined
}

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

const toStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string') as string[]
  }
  if (typeof value === 'string') {
    return [value]
  }
  return undefined
}

const compactObject = <T extends Record<string, unknown>>(value: T) => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== 'undefined'),
  ) as Partial<T>
}

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  database: env.DATABASE_URL
    ? new Pool({ connectionString: env.DATABASE_URL })
    : new Database('auth-db.sqlite'),
  updateAccountOnSignIn: true,
  user: {
    deleteUser: {
      enabled: true,
    },
    additionalFields: {
      vpn_username: { type: 'string', required: false },
      preferred_username: { type: 'string', required: false },
      vpn_config: { type: 'json', required: false },
    },
  },
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'],
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'oauth',
          clientId: env.OPENID_CLIENT_ID,
          clientSecret: env.OPENID_CLIENT_SECRET,
          discoveryUrl: env.OPENID_DISCOVERY_URL,
          pkce: true,
          scopes: ['openid', 'email', 'profile'],
          mapProfileToUser: (profile: OAuthProfile) => {
            const vpnConfig: VpnConfig = {
              traffic_limit_gb: toNumber(getClaim(profile, 'PANEL_USER_TRAFFIC_LIMIT_GB')),
              data_limit_reset_strategy: getClaim(profile, 'DATA_LIMIT_RESET_STRATEGY'),
              expiry_date: getClaim(profile, 'PANEL_USER_EXPIRY_DATE'),
              proxies: toStringArray(getClaim(profile, 'PANEL_USER_PROXIES')),
              default_proxy: getClaim(profile, 'DEFAULT_PROXY'),
            }

            const cleanedVpnConfig = compactObject(vpnConfig)

            return {
              email: profile.email as string,
              name: profile.name as string,
              image: profile.picture as string,
              vpn_username: getClaim(profile, 'vpn_username'),
              preferred_username: getClaim(profile, 'preferred_username'),
              vpn_config: Object.keys(cleanedVpnConfig).length ? cleanedVpnConfig : undefined,
            }
          },
        },
      ],
    }),
    nextCookies(),
  ],
})
