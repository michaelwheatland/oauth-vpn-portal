# VPN Portal OAuth Integration Implementation Plan

## Overview
Implement full OAuth claim mapping from Authentik to Marzban user provisioning, supporting per-user/group configuration via JWT claims.

---

## Milestone 1: OAuth Claim Extraction & Storage

### 1.1 Extend BetterAuth User Model
- [ ] Add custom fields to user schema for VPN-specific claims
- [ ] Store: `vpn_username`, `vpn_config` (JSON blob for traffic/expiry/proxies)
- [ ] Update `src/lib/auth.ts` `mapProfileToUser()` to extract:
  - `preferred_username` OR `vpn_username` → username
  - `PANEL_USER_TRAFFIC_LIMIT_GB` (root or `vpn.*`)
  - `DATA_LIMIT_RESET_STRATEGY` (root or `vpn.*`)
  - `PANEL_USER_EXPIRY_DATE` (root or `vpn.*`)
  - `PANEL_USER_PROXIES` (root or `vpn.*`)

### 1.2 Database Migration
- [ ] Run BetterAuth migration to add custom user fields
- [ ] Test with existing users (ensure backward compatibility)

---

## Milestone 2: Marzban User Creation Logic

### 2.1 Update Username Mapping
**File**: `src/lib/panel-api/marzban.ts`

- [ ] Create `getUsernameFromWebUser(user)` function:
  - Use `user.vpn_username` OR `user.preferred_username`
  - Fallback to `user.email.split('@')[0]`
  - Apply `PANEL_USER_ID_PREFIX` if configured
  - Sanitize for Marzban constraints (lowercase, no special chars, max length)

### 2.2 Dynamic Proxy Configuration
- [ ] Create `getProxiesFromClaims(user, instanceInbounds)` function:
  - If `user.vpn_config.proxies` exists: map to Marzban proxy types
  - Else: return all enabled proxies from Marzban instance
  - Support: `trojan`, `vless`, `shadowsocks`, `vmess`
  - Each proxy type needs proper config (flow, method, etc.)

### 2.3 Update `createNewPanelUser()`
- [ ] Replace hardcoded username with `getUsernameFromWebUser()`
- [ ] Replace `DEFAULT_PROXY` with `getProxiesFromClaims()`
- [ ] Use `user.vpn_config.traffic_limit` (fallback: `env.PANEL_USER_TRAFFIC_LIMIT_GB`)
- [ ] Use `user.vpn_config.reset_strategy` (fallback: `'month'`)
- [ ] Use `user.vpn_config.expiry_date` (fallback: `EXPIRE_NEVER`)

### 2.4 Proxy Defaults Configuration
**File**: `src/lib/panel-api/defaults.ts`

- [ ] Expand `DEFAULT_PROXY` to include Trojan:
  ```typescript
  trojan: {
    password: '', // Marzban auto-generates
  }
  ```
- [ ] Add helper to generate proxy config per protocol type

---

## Milestone 3: VPN Page Marzban Implementation

### 3.1 Add Marzban Branch to VPN Page
**File**: `src/app/vpn/page.tsx`

- [ ] Add Marzban conditional branch (parallel to Remnawave)
- [ ] Instantiate `MarzbanAPI` with credentials:
  ```typescript
  const marzbanAPI = new MarzbanAPI({
    baseURL: env.PANEL_API_URL,
    username: env.MARZBAN_USERNAME,
    password: env.MARZBAN_PASSWORD,
  })
  ```
- [ ] Call `getOrCreatePanelUser(user)`
- [ ] Call `updatePanelUser(user)` to sync traffic limits
- [ ] Render subscription view component

### 3.2 Create Marzban Subscription View
- [ ] Copy/adapt `SubViewComponent` for Marzban response format
- [ ] Display: subscription URL, QR codes, traffic usage, expiry
- [ ] Handle Marzban-specific link formats

---

## Milestone 4: Environment & Configuration

### 4.1 Update Environment Variables
**File**: `src/lib/env.ts`

- [ ] Add validation for Marzban credentials when `PANEL_TYPE=marzban`
- [ ] Make `PANEL_USER_TRAFFIC_LIMIT_GB` optional (OAuth override)
- [ ] Document that OAuth claims take precedence over env vars

### 4.2 Update `.env.example`
- [ ] Add comments explaining OAuth claim precedence
- [ ] Document expected JWT claim structure
- [ ] Note: `PANEL_USER_TRAFFIC_LIMIT_GB=0` means unlimited (unless OAuth overrides)

---

## Milestone 5: Error Handling & Edge Cases

### 5.1 Username Conflicts
- [ ] Handle existing Marzban users with same username
- [ ] Option 1: Append suffix (`immi_1`)
- [ ] Option 2: Error to user with instructions
- [ ] Log conflict events for debugging

### 5.2 Invalid OAuth Claims
- [ ] Validate `PANEL_USER_PROXIES` against Marzban instance capabilities
- [ ] Warn if requested proxy not available (fallback gracefully)
- [ ] Handle missing/malformed claims (use env defaults)

### 5.3 Marzban API Errors
- [ ] Improve error messages in `createNewPanelUser()`
- [ ] Display user-friendly errors on VPN page
- [ ] Log full error details for debugging

---

## Milestone 6: Testing & Validation

### 6.1 Unit Tests
- [ ] Test `getUsernameFromWebUser()` with various inputs
- [ ] Test `getProxiesFromClaims()` with different claim sets
- [ ] Test username sanitization edge cases

### 6.2 Integration Tests
- [ ] Test full OAuth → Marzban flow:
  1. Fresh user login via Authentik
  2. User created in Marzban with correct attributes
  3. Subscription displayed correctly
  4. User can re-login (no duplicate creation)

### 6.3 Manual Testing Checklist
- [ ] User with `vpn_username` claim → correct Marzban username
- [ ] User with `PANEL_USER_PROXIES: ["trojan"]` → only Trojan enabled
- [ ] User with traffic limit override → Marzban user has custom limit
- [ ] User without claims → env defaults applied
- [ ] Existing Marzban user → no duplicate, updates applied

---

## Milestone 7: Documentation & Deployment

### 7.1 Update README
- [ ] Document OAuth claim mapping requirements
- [ ] Provide Authentik configuration example
- [ ] Explain claim precedence: JWT > env vars
- [ ] Note Marzban username constraints

### 7.2 Create Migration Guide
- [ ] Steps for existing deployments to upgrade
- [ ] Database migration commands
- [ ] Authentik claim configuration template

### 7.3 Fork Repository
- [ ] Fork to personal Git server (git.wheatland.com.au)
- [ ] Update remote URLs
- [ ] Create feature branch: `michael/oauth-claim-mapping`
- [ ] Set up CI/CD if needed

---

## Technical Notes

### OAuth Claim Priority
```
1. JWT `vpn_username` OR `preferred_username`
2. JWT root-level VPN claims (e.g., `PANEL_USER_TRAFFIC_LIMIT_GB`)
3. JWT nested claims (e.g., `vpn.PANEL_USER_TRAFFIC_LIMIT_GB`)
4. Environment variables
5. Hardcoded defaults
```

### Marzban Username Constraints
- Lowercase only (likely)
- No special characters except underscore/hyphen
- Max length: ~32 chars (validate against Marzban API docs)
- Must be unique

### BetterAuth Custom Fields
- Requires schema extension via `additionalFields` config
- Fields stored in `user` table
- Accessible in session via `user` object

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| BetterAuth doesn't support custom fields easily | Store in JSON `metadata` field if needed |
| Marzban API changes break integration | Pin marzban-sdk version, test upgrades |
| Username conflicts with existing Marzban users | Implement conflict resolution strategy |
| OAuth provider sends malformed claims | Validate all inputs, log errors, fallback to defaults |

---

## Success Criteria
- [ ] User logs in via Authentik OAuth
- [ ] Marzban user created with `vpn_username` as username
- [ ] Traffic limit matches JWT claim (500GB for Imogen)
- [ ] Only Trojan protocol enabled (per JWT claim)
- [ ] Subscription URL displayed on VPN page
- [ ] No server errors in production
