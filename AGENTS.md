# Agent Instructions for OAuth VPN Portal

## Project Overview

**Goal**: Implement OAuth claim-based user provisioning for Marzban VPN panel, enabling per-user/group configuration via Authentik JWT claims.

**Current State**: Portal supports Remnawave but lacks Marzban implementation. OAuth login works but user creation fails due to username mismatch between BetterAuth auto-generated IDs and Marzban requirements.

**Target State**: Fully functional OAuth → Marzban flow with dynamic user configuration from JWT claims (username, traffic limits, expiry, protocols).

---

## Critical Boundary Conditions (DO NOT MODIFY)

### 1. Upstream Authentik JWT Structure

The OAuth provider (Authentik) sends the following JWT claims **which you cannot change**:

```json
{
  "email": "user@example.com",
  "email_verified": true,
  "name": "Display Name",
  "given_name": "First",
  "preferred_username": "username",
  "nickname": "nick",
  "groups": ["Family", "Admin"],
  "vpn": {
    "PANEL_USER_TRAFFIC_LIMIT_GB": 500,
    "DATA_LIMIT_RESET_STRATEGY": "month",
    "PANEL_USER_EXPIRY_DATE": null,
    "PANEL_USER_PROXIES": ["trojan", "vless"],
    "DEFAULT_PROXY": "trojan"
  },
  "PANEL_USER_TRAFFIC_LIMIT_GB": 500,
  "DATA_LIMIT_RESET_STRATEGY": "month",
  "PANEL_USER_EXPIRY_DATE": null,
  "PANEL_USER_PROXIES": ["trojan"],
  "vpn_username": "immi"
}
```

**Priority**: Root-level claims take precedence over nested `vpn.*` claims.

**Your Task**: Extract these claims via BetterAuth `mapProfileToUser()` and store in user model.

### 2. Marzban API Constraints

**Username Requirements**:
- Likely lowercase only (validate empirically)
- No special characters (except `_`/`-` possibly)
- Max length ~32 chars
- Must be unique across Marzban instance

**API Fields** (via marzban-sdk):
```typescript
{
  username: string,
  note?: string,
  data_limit?: number,              // bytes, not GB
  data_limit_reset_strategy: 'no_reset' | 'day' | 'week' | 'month' | 'year',
  expire?: number,                   // Unix timestamp (seconds)
  inbounds: Record<string, string[]>, // { vless: ['tag1'], trojan: ['tag2'] }
  proxies: Record<string, object>    // { vless: {flow: ''}, trojan: {} }
}
```

**Key Conversions**:
- GB → bytes: Use existing `gbToBytes()` utility
- `null` expiry → `EXPIRE_NEVER` constant (2099-05-09)
- Proxy list `["trojan"]` → `{ trojan: {} }`

### 3. BetterAuth Limitations

**User Model Extension**:
- BetterAuth may not support custom fields directly
- Fallback: Store VPN config as JSON in existing field (e.g., `metadata` or use BetterAuth hooks)
- Test if `mapProfileToUser()` can store additional fields beyond `email`, `name`, `image`

**Session Access**:
- User object must be accessible in React Server Components
- Retrieved via `getSessionOrRedirect()` helper

---

## Code Style & Tooling

### Linting & Formatting

**Tooling**: Biome (NOT ESLint/Prettier)

**Commands**:
```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
npm run format        # Format code
npm run format:check  # Check formatting without fixing
```

**Configuration** (`biome.json`):
- **Indent**: 2 spaces
- **Line Width**: 100 characters
- **Quotes**: Single quotes (`'`)
- **Semicolons**: As needed (not required)
- **Import Organization**: Auto-sorted

**Ignored Paths**:
- `node_modules`, `.next`, `dist`, `build`
- `src/components/ui` (shadcn/ui generated)

**Before Committing**: ALWAYS run `npm run lint:fix`

### TypeScript

**Config** (`tsconfig.json`):
- Strict mode enabled
- Path aliases: `@/*` → `./src/*`, `~/*` → `./public/*`
- Module resolution: `bundler`

**Best Practices**:
- Use proper types from imported SDKs (`marzban-sdk`, `better-auth`)
- Avoid `any` types
- Use `type` for objects, `interface` for extensible contracts (but project uses `type` primarily)

### File Structure

```
src/
├── app/
│   ├── api/auth/[...all]/route.ts   # BetterAuth handler
│   └── vpn/page.tsx                  # Main VPN page (ADD MARZBAN BRANCH HERE)
├── lib/
│   ├── auth.ts                       # BetterAuth config (MODIFY mapProfileToUser)
│   ├── env.ts                        # Environment validation (zod)
│   ├── session.ts                    # Session helpers
│   ├── utils.ts                      # gbToBytes, etc.
│   └── panel-api/
│       ├── defaults.ts               # Constants (EXPAND DEFAULT_PROXY)
│       ├── marzban.ts                # Marzban API wrapper (MAIN IMPLEMENTATION)
│       └── remnawave.ts              # Remnawave (reference implementation)
└── components/
    └── RemnawaveSubscriptionView.tsx # UI component (adapt for Marzban)
```

---

## Development Workflow

### Database Migrations

After modifying user schema (if extending BetterAuth):
```bash
npm run db:migrate
```

**Important**: Uses BetterAuth CLI with telemetry disabled.

### Local Development

```bash
npm run dev  # Starts Next.js with Turbopack (faster)
```

**Environment**: Copy `.env.example` to `.env` and configure:
- `PANEL_TYPE=marzban` (not `remnawave`)
- `MARZBAN_USERNAME`, `MARZBAN_PASSWORD` (admin credentials)
- `PANEL_API_URL` (Marzban server URL)

### Testing Changes

**Manual Test Flow**:
1. Clear browser cookies/session
2. Delete test user from Marzban (`curl -X DELETE ...` or via admin panel)
3. Login via OAuth
4. Verify Marzban user created with correct:
   - Username (from `vpn_username` claim)
   - Traffic limit (from JWT, not env)
   - Proxies (only those in `PANEL_USER_PROXIES` claim)
5. Check subscription URL displays on `/vpn` page

**Validation Points**:
- No server errors in browser console
- No 400/404 from Marzban API (check server logs)
- User can download VPN config

---

## Git Workflow

### Branch Naming

**Pattern**: `michael/feature-name`

**Current Branch**: `michael/oauth-claim-mapping`

### Commit Messages

**Format**: Conventional Commits
```bash
git commit -m "feat: add OAuth claim extraction to BetterAuth"
git commit -m "fix: sanitize username for Marzban constraints"
git commit -m "refactor: extract proxy config logic to helper"
git commit -m "docs: update README with OAuth claim requirements"
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

### Before Pushing

```bash
npm run lint:fix       # Fix linting issues
npm run format         # Format code
npm run build          # Ensure no build errors
git add .
git commit -m "..."
git push origin michael/oauth-claim-mapping
git push gitea michael/oauth-claim-mapping  # Mirror to Gitea
```

---

## Implementation Guidelines

### Username Mapping Priority

1. `user.vpn_username` (custom claim)
2. `user.preferred_username` (OIDC standard)
3. `user.email.split('@')[0]` (fallback)
4. Sanitize result (lowercase, strip invalid chars, truncate to 32)

### Proxy Configuration Logic

**Input**: `PANEL_USER_PROXIES: ["trojan", "vless"]`

**Output**:
```typescript
{
  trojan: {},
  vless: { flow: '' }
}
```

**Defaults** (when claim missing):
- Load all inbounds from Marzban server
- Enable all proxy types found

**Proxy Defaults per Type**:
```typescript
const PROXY_DEFAULTS = {
  trojan: {},
  vless: { flow: '' },
  vmess: {},
  shadowsocks: { method: 'chacha20-ietf-poly1305' }
}
```

### Error Handling

**Username Conflicts**:
- Marzban returns 400 if username exists
- Strategy: Append `_1`, `_2`, etc. until unique
- Log warning for admin review

**Missing Claims**:
- Always provide fallbacks to env vars
- Never fail user creation due to missing optional claim
- Log when using fallbacks

**Marzban API Errors**:
- Catch all errors in `createNewPanelUser()`
- Display user-friendly message on VPN page
- Log full error details to console (server-side)

### Configuration Precedence

```
1. JWT claim (highest priority)
2. Environment variable
3. Hardcoded default (lowest priority)
```

**Example**:
```typescript
const trafficLimit =
  user.vpn_config?.traffic_limit ||       // JWT claim
  env.PANEL_USER_TRAFFIC_LIMIT_GB ||      // .env config
  0                                        // Unlimited default
```

---

## Testing Checklist

### Unit Tests (if implementing)

- [ ] `getUsernameFromWebUser()` with various inputs
- [ ] `getProxiesFromClaims()` with different claim sets
- [ ] Username sanitization edge cases (uppercase, special chars, length)

### Integration Tests

- [ ] Fresh user OAuth login → Marzban user created
- [ ] Existing user re-login → no duplicate creation
- [ ] User with custom traffic limit → Marzban reflects limit
- [ ] User with specific proxies → only requested proxies enabled
- [ ] Missing claims → env defaults applied

### Manual Testing Scenarios

**User: Imogen** (from provided JWT):
- [x] Username should be `immi` (not BetterAuth ID)
- [x] Traffic limit: 500GB (not env default)
- [x] Reset strategy: monthly
- [x] Expiry: none (2099-05-09)
- [x] Proxy: Trojan only (not all proxies)

**User: No Claims** (minimal JWT):
- [ ] Username: email prefix
- [ ] Traffic: env default or 0
- [ ] Proxies: all available from Marzban

---

## Common Pitfalls & Solutions

| Issue | Solution |
|-------|----------|
| BetterAuth doesn't store custom claims | Use existing field (e.g., store JSON in `name` field temporarily) or use BetterAuth hooks |
| Marzban rejects username | Sanitize: lowercase, replace invalid chars with `_`, truncate to 32 |
| 400 error on user creation | Check Marzban logs, validate all required fields, test with minimal payload |
| Proxy config wrong format | Ensure `{ trojan: {} }` NOT `["trojan"]` |
| GB to bytes conversion | Use `gbToBytes()` from `src/lib/utils.ts` |
| Expiry date null handling | Convert to `EXPIRE_NEVER` (2099-05-09) timestamp |

---

## Reference Implementations

### Remnawave as Template

`src/lib/panel-api/remnawave.ts` shows correct pattern:
- Username formatting (`formatUsername()`)
- Error handling (try/catch with AxiosError)
- Dynamic config loading (`loadInternalSquads()`)
- User retrieval with null fallback

**Adapt for Marzban**: Follow same structure but use Marzban SDK methods.

### VPN Page Pattern

`src/app/vpn/page.tsx` (Remnawave branch):
```typescript
if (env.PANEL_TYPE === 'remnawave') {
  const api = new RemnawaveAPI(...)
  const user = await api.getOrCreatePanelUser(user)
  await api.updatePanelUser(user)
  return <SubViewComponent subscription={user} />
}
```

**TODO**: Add parallel `if (env.PANEL_TYPE === 'marzban')` branch with MarzbanAPI.

---

## Success Criteria

**Definition of Done**:
1. User logs in via Authentik OAuth
2. Portal extracts `vpn_username` from JWT
3. Marzban user created with JWT-specified config (not env defaults)
4. Subscription URL displayed on `/vpn` page
5. No errors in browser console or server logs
6. Code passes `npm run lint:fix`
7. Builds successfully (`npm run build`)
8. Manual test with Imogen's JWT succeeds (500GB, Trojan only, username `immi`)

---

## Resources

- **Marzban SDK**: [marzban-sdk](https://www.npmjs.com/package/marzban-sdk)
- **BetterAuth Docs**: [better-auth.com](https://www.better-auth.com)
- **Next.js 15**: [nextjs.org/docs](https://nextjs.org/docs)
- **Biome**: [biomejs.dev](https://biomejs.dev)
- **Implementation Plan**: See `TODO.md` for detailed milestone breakdown

---

## Questions to Ask User

If you encounter ambiguity:
- How to handle username conflicts? (append suffix vs. error)
- Should `DEFAULT_PROXY` claim affect UI sorting/display?
- Traffic limit of 0 in JWT: unlimited or block creation?
- Expiry date in past: reject or allow?

Always clarify before implementing assumptions.
