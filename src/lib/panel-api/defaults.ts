export const PANEL_USER_ID_PREFIX = ''
export const EXPIRE_NEVER = new Date('2099-05-09T00:00:00.000Z') // set 2099 as never expire, what could possible go wrong?
export const DEFAULT_INBOUNDS = {
  vmess: ['VMess TCP', 'VMess Websocket'],
  vless: ['VLESS TCP REALITY', 'VLESS GRPC REALITY'],
  trojan: ['Trojan Websocket TLS'],
  shadowsocks: ['Shadowsocks TCP'],
}

export const MARZBAN_PROXY_DEFAULTS = {
  trojan: {},
  vless: { flow: '' },
  vmess: {},
  shadowsocks: { method: 'chacha20-ietf-poly1305' },
}
