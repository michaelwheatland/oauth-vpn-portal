import type { User } from 'better-auth'
import { type Config, MarzbanSDK, type UserApi } from 'marzban-sdk'
import { env } from '../env'
import { gbToBytes } from '../utils'
import { EXPIRE_NEVER, MARZBAN_PROXY_DEFAULTS, PANEL_USER_ID_PREFIX } from './defaults'

export type MarzbanPanelUser = Awaited<ReturnType<UserApi['getUser']>>
type DataLimitResetStrategy = NonNullable<
  Parameters<UserApi['addUser']>[0]['data_limit_reset_strategy']
>

type VpnConfig = {
  traffic_limit_gb?: number
  data_limit_reset_strategy?: string
  expiry_date?: string | number | null
  proxies?: string[]
  default_proxy?: string
}

type WebUser = User & {
  vpn_username?: string | null
  preferred_username?: string | null
  vpn_config?: VpnConfig | null
}

type Inbound = {
  type?: string
  tag?: string
  port?: number
}

type InboundsOverride = Record<string, string[]>

const RESET_STRATEGIES = new Set(['no_reset', 'day', 'week', 'month', 'year'])

const normalizeResetStrategy = (value: unknown): DataLimitResetStrategy | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase().trim()
  if (RESET_STRATEGIES.has(normalized)) {
    return normalized as DataLimitResetStrategy
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

const sanitizeUsername = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32)
}

const buildUsernameWithSuffix = (base: string, suffix: number) => {
  if (suffix === 0) return base
  const suffixValue = `_${suffix}`
  const maxBaseLength = Math.max(1, 32 - suffixValue.length)
  return `${base.slice(0, maxBaseLength)}${suffixValue}`
}

const getUsernameFromWebUser = (user: WebUser) => {
  const preferred = user.vpn_username || user.preferred_username
  const emailPrefix = user.email?.split('@')[0]
  const raw = preferred || emailPrefix || user.id
  return sanitizeUsername(`${PANEL_USER_ID_PREFIX}${raw}`)
}

const getTrafficLimitBytes = (user: WebUser) => {
  const claimLimit = toNumber(user.vpn_config?.traffic_limit_gb)
  if (typeof claimLimit !== 'undefined') {
    if (claimLimit === 0) return undefined
    return gbToBytes(claimLimit)
  }

  if (env.PANEL_USER_TRAFFIC_LIMIT_GB === 0) return undefined
  return gbToBytes(env.PANEL_USER_TRAFFIC_LIMIT_GB)
}

const getExpirySeconds = (user: WebUser) => {
  const expiry = user.vpn_config?.expiry_date
  if (expiry === null) return Math.floor(EXPIRE_NEVER.getTime() / 1000)
  if (typeof expiry === 'number') {
    return expiry > 1_000_000_000_000 ? Math.floor(expiry / 1000) : Math.floor(expiry)
  }
  if (typeof expiry === 'string' && expiry.trim() !== '') {
    const parsed = Date.parse(expiry)
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000)
    }
  }

  return Math.floor(EXPIRE_NEVER.getTime() / 1000)
}

const getResetStrategy = (user: WebUser): DataLimitResetStrategy => {
  const claim = normalizeResetStrategy(user.vpn_config?.data_limit_reset_strategy)
  return claim ?? 'month'
}

const normalizeProxyList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.toLowerCase().trim()
    return trimmed ? [trimmed] : []
  }
  return []
}

const getProxyTypes = (user: WebUser, inbounds: Inbound[]) => {
  const requested = normalizeProxyList(user.vpn_config?.proxies)
  const availableTypes = new Set(
    inbounds.map((inbound) => inbound.type).filter((type): type is string => Boolean(type)),
  )

  const allowedTypes = new Set(Object.keys(MARZBAN_PROXY_DEFAULTS))
  const filteredRequested = requested.filter(
    (type) => availableTypes.has(type) && allowedTypes.has(type),
  )

  if (filteredRequested.length > 0) return filteredRequested

  const fallbackTypes = Array.from(availableTypes).filter((type) => allowedTypes.has(type))
  if (fallbackTypes.length > 0) return fallbackTypes

  return Object.keys(MARZBAN_PROXY_DEFAULTS)
}

const buildInboundsMap = (inbounds: Inbound[], proxyTypes: string[]) => {
  const allowed = new Set(proxyTypes)
  return inbounds.reduce(
    (acc, inbound) => {
      if (!inbound.type || !inbound.tag) {
        return acc
      }
      if (!allowed.has(inbound.type)) {
        return acc
      }
      if (!acc[inbound.type]) {
        acc[inbound.type] = []
      }
      acc[inbound.type].push(inbound.tag)
      return acc
    },
    {} as Record<string, string[]>,
  )
}

const buildProxiesMap = (proxyTypes: string[]) => {
  return proxyTypes.reduce(
    (acc, type) => {
      const defaults = MARZBAN_PROXY_DEFAULTS[type as keyof typeof MARZBAN_PROXY_DEFAULTS]
      if (defaults) {
        acc[type] = defaults
      }
      return acc
    },
    {} as Record<string, object>,
  )
}

const getOverrideProxyTypes = (override: InboundsOverride) => {
  const rawTypes = Object.keys(override)
  const allowed = new Set(Object.keys(MARZBAN_PROXY_DEFAULTS))
  const filtered = rawTypes.filter((type) => allowed.has(type))
  return filtered.length > 0 ? filtered : rawTypes
}

export class MarzbanAPI {
  private marzban: MarzbanSDK

  constructor(config: Config) {
    this.marzban = new MarzbanSDK(config)
  }

  private async findPanelUserByUsername(username: string): Promise<MarzbanPanelUser | null> {
    try {
      const user = await this.marzban.user.getUser(username)
      return user
    } catch (error) {
      return null
    }
  }

  private async getAvailableUsername(baseUsername: string, userId: string) {
    const base = sanitizeUsername(baseUsername)
    for (let index = 0; index < 20; index += 1) {
      const candidate = buildUsernameWithSuffix(base, index)
      const existing = await this.findPanelUserByUsername(candidate)
      if (!existing) {
        return candidate
      }
      if (existing.note?.includes(userId)) {
        return candidate
      }
    }
    throw new Error('Failed to find available Marzban username')
  }

  async createNewPanelUser(webSiteUser: User): Promise<MarzbanPanelUser> {
    const vpnUser = webSiteUser as WebUser
    const baseUsername = getUsernameFromWebUser(vpnUser)
    const username = await this.getAvailableUsername(baseUsername, webSiteUser.id)
    const inboundsOverride = env.MARZBAN_USER_INBOUNDS as InboundsOverride | undefined
    const inbounds = inboundsOverride ? [] : await this.loadInstanceInbounds()
    const proxyTypes = inboundsOverride
      ? getOverrideProxyTypes(inboundsOverride)
      : getProxyTypes(vpnUser, inbounds)
    const inboundsMap = inboundsOverride ? inboundsOverride : buildInboundsMap(inbounds, proxyTypes)

    const params: Parameters<UserApi['addUser']>[0] = {
      username,
      note: `User by oauth-vpn-portal, oauth details: ${JSON.stringify(webSiteUser)}`,
      data_limit: getTrafficLimitBytes(vpnUser),
      data_limit_reset_strategy: getResetStrategy(vpnUser),
      expire: getExpirySeconds(vpnUser),
      inbounds: inboundsMap,
      proxies: buildProxiesMap(proxyTypes),
    }

    try {
      return await this.marzban.user.addUser(params)
    } catch (error) {
      const maybeError = error as {
        response?: { status?: number; data?: unknown }
        message?: string
      }
      console.error('Marzban addUser failed', {
        message: maybeError.message,
        status: maybeError.response?.status,
        data: maybeError.response?.data,
        username,
        inbounds: params.inbounds,
        proxies: params.proxies,
      })
      throw error
    }
  }

  async getOrCreatePanelUser(webSiteUser: User): Promise<MarzbanPanelUser> {
    let user = await this.getPanelUser(webSiteUser)
    if (!user) {
      user = await this.createNewPanelUser(webSiteUser)
    }
    return user
  }

  /**
   * This updates the user's traffic limit
   * @param webSiteUser - The user from the web site
   */
  async updatePanelUser(webSiteUser: User) {
    const vpnUser = webSiteUser as WebUser
    const baseUsername = getUsernameFromWebUser(vpnUser)
    const username = await this.getAvailableUsername(baseUsername, webSiteUser.id)
    await this.marzban.user.modifyUser(username, {
      data_limit: getTrafficLimitBytes(vpnUser),
      data_limit_reset_strategy: getResetStrategy(vpnUser),
      expire: getExpirySeconds(vpnUser),
    })
  }

  async getPanelUser(webSiteUser: User): Promise<MarzbanPanelUser | null> {
    const vpnUser = webSiteUser as WebUser
    const baseUsername = getUsernameFromWebUser(vpnUser)

    for (let index = 0; index < 20; index += 1) {
      const candidate = buildUsernameWithSuffix(baseUsername, index)
      const existing = await this.findPanelUserByUsername(candidate)
      if (!existing) continue
      if (!existing.note || existing.note.includes(webSiteUser.id)) {
        return existing
      }
    }

    return null
  }

  async deletePanelUser(webSiteUser: User): Promise<void> {
    const existing = await this.getPanelUser(webSiteUser)
    if (!existing) return
    await this.marzban.user.removeUser(existing.username)
  }

  async loadInstanceInbounds() {
    const marzbanResponse = await this.marzban.system.getInbounds()
    const arrayOfInbounds: Inbound[] = []
    for (const [type, inbounds] of Object.entries(marzbanResponse)) {
      if (!Array.isArray(inbounds)) continue
      for (const inbound of inbounds) {
        arrayOfInbounds.push({
          ...inbound,
          type,
          port: Number(inbound.port),
        })
      }
    }

    return arrayOfInbounds
  }
}
