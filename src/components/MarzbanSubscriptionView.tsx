import type { MarzbanPanelUser } from '@/lib/panel-api/marzban'
import { formatBytes } from '@/lib/utils'
import type { User } from 'better-auth'

const formatExpiry = (expiry?: number | null) => {
  if (!expiry) return 'No expiry'
  const date = new Date(expiry * 1000)
  return Number.isNaN(date.getTime()) ? 'No expiry' : date.toLocaleString()
}

const getSubscriptionLinks = (subscription: MarzbanPanelUser) => {
  if (subscription.subscription_url) return [subscription.subscription_url]
  if (Array.isArray(subscription.links) && subscription.links.length > 0) return subscription.links
  return []
}

export const MarzbanSubscriptionView = ({
  subscription,
  user,
}: { subscription: MarzbanPanelUser; user: User }) => {
  const links = getSubscriptionLinks(subscription)
  const dataLimit = subscription.data_limit
  const usedTraffic = subscription.used_traffic

  return (
    <div className="w-full flex justify-center items-center">
      <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">VPN subscription</h1>
          <p className="text-sm text-gray-500">Signed in as {user.email}</p>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Username:</span> {subscription.username}
          </div>
          <div>
            <span className="font-medium">Data used:</span>{' '}
            {typeof usedTraffic === 'number'
              ? formatBytes(usedTraffic, { decimals: 2 })
              : 'Unknown'}
          </div>
          <div>
            <span className="font-medium">Data limit:</span>{' '}
            {typeof dataLimit === 'number' && dataLimit > 0
              ? formatBytes(dataLimit, { decimals: 2 })
              : 'Unlimited'}
          </div>
          <div>
            <span className="font-medium">Expiry:</span> {formatExpiry(subscription.expire)}
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-sm font-semibold">Subscription links</h2>
          {links.length === 0 ? (
            <p className="text-sm text-gray-500">No subscription link available.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {links.map((link) => (
                <div key={link} className="break-all rounded border border-gray-200 bg-gray-50 p-2">
                  <a className="text-sm text-blue-600 underline" href={link}>
                    {link}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
