# URACCA Affiliation System — Complete Technical Documentation

## 1. Document Information

| Item | Value |
| --- | --- |
| Document | URACCA Affiliation System technical Side |
| Written from | Source inspection on 26 September 2026 |
| Backend repository | `/Users/haashimac/affiliate.server` — GitHub `https://github.com/haashtech/affiliate.server.git` |
| Affiliate portal repository | `/Users/haashimac/affiliate.uracca.com` — GitHub `https://github.com/haashtech/affiliate.uracca.com.git` |
| Current branches inspected | `main`  |
| Package names | Backend `aff-server-2025`. Portal `uracca-affiliate-2025`. SDK `@haash/affiliate` (source in `affiliate.server/haash-affiliate`, published version in that package.json is `1.0.19`) |

### What was inspected

- Affiliate Server: Express entry, routes, controllers, models, middleware, cron, Razorpay payout/webhook, and the `@haash/affiliate` SDK.
- Affiliate portal: Next.js App Router pages, NextAuth, Next API routes, Redux, and the axios services that call the affiliate server.
- Environment variable **names** as they appear in code. Values are not copied. Secrets are written as `<REDACTED>`.

### What was not in these repositories

These applications are referenced by CORS, SDK defaults, and platform URLs, but their source was **not** in the workspace. Behaviour below is documented only where this code proves it. Anything that would live only in those apps is marked **not verified here**.

| Application | Evidence in this code | Source inspected? |
| --- | --- | --- |
| URACCA Store (customer shop) | CORS origins `uracca.com`, `uracca.in`, `example.uracca.com`, `example.uracca.in`. SDK is meant to be called by a store. Local campaign links default to `http://localhost:3002/`. | No |
| URACCA / Affiliate Admin UI | CORS origins `admin.uracca.com`, `admin.uracca.in`, and `{tenant}.admin.uracca.com`. Admin APIs exist on the affiliate server. | No |
| Main commerce server (orders, Razorpay checkout) | Store product catalog is fetched from `Platform.backendRoutes.products`. Customer payment verification is not implemented in the affiliate server. | No |

There is no PM2 file, Dockerfile, nginx config, or CloudPanel config in either repository.

---

## 2. System Overview

### What URACCA Affiliation is

URACCA Affiliation is the system that lets a person promote a store product, share a tracked link, and earn a commission when a customer order is reported against that link.

It is split across:

1. **Affiliate portal** (`affiliate.uracca.com`) — registration, login, campaigns, earnings, wallet, withdrawals, tiers.
2. **Affiliate server** (`affiliate.server`) — the API, MongoDB writes for affiliates, campaigns, commissions, wallets, and payouts.
3. **`@haash/affiliate` SDK** — the only integration surface the store is expected to call for clicks, purchases, and commission cancellation.
4. **A storefront and a store admin** — they are separate applications. This affiliation code does not create the customer order and does not charge the customer.

### Why it exists

A store (URACCA or a tenant store such as `example.uracca.com` / `example.uracca.in`) wants affiliates to sell specific products. The affiliation system records who shared the link, which campaign it belonged to, and how much commission is owed after TDS. Money becomes withdrawable only after a return window, then an admin pays it out (online payouts go through RazorpayX).

### Who uses it

| Role | `userType` | Where they work |
| --- | --- | --- |
| Affiliate | `USER` | Affiliate portal |
| Platform admin | `ADMIN` | Admin UI (not in these repos) calling affiliate-server admin routes |
| Super admin | `SUPER_ADMIN` | Same admin APIs. Can register further admins after the first super admin exists. First super admin can be created while none exists. |

Customers do not have affiliate accounts. They use the store. The store then calls the SDK.

### How the main objects connect

```
Platform (one store / admin)
    │
    ├── Products copied or synced into the affiliate Product collection
    │
    └── Affiliates (User, userType USER)
            │
            └── Campaign (one product + one access key + one link)
                    │
                    ├── Click counters (campaign.clicks, user.actions.totalClicks, DailyAction)
                    │
                    └── Commission (one document per store orderId)
                            │
                            └── After returnPeriod + 1 days, cron marks PAID
                                    │
                                    └── Wallet.balanceAmount increases
                                            │
                                            └── Withdrawal (BANK or ONLINE / UPI or bank via Razorpay)
```

There is also a separate **tier / reward** track. Clicks and orders increment tier goals. Cash rewards credit the wallet only when an admin marks the collected reward `PAID`.

### End-to-end flow and which app owns each step

| Step | Application that owns it |
| --- | --- |
| Affiliate registration and OTP | Affiliate portal writes MongoDB directly (`src/app/api/auth/*`). The affiliate server also has `POST /api/user/user-register`, which uploads documents and sends OTP. The portal register action posts to the portal route, not the server route. |
| Affiliate login | Portal calls affiliate server `POST /api/user/user-login` (cookie `aff_ses_server`), then NextAuth `signIn` (cookie `aff_ses_tkn`) against the same MongoDB. |
| Admin approval | Admin calls `PUT /api/user/update-status/:userId` on the affiliate server. The admin UI source is not in these repos. |
| Product list for a campaign | Affiliate server `GET /api/users/products/newCampaign/:adminId` loads the store catalog from `Platform.backendRoutes.products` and overlays local commission / active flags. |
| Campaign creation and link | Affiliate server `PUT /api/users/campaign/create`. Link shape: `{domain}products/{slug}?aff={referralId}&campKey={campaignAccessKey}`. |
| Customer click | **Store** must read `aff` and `campKey` and call SDK `TrackClick`. That hits `POST /api/affiliate/clicks`. Persistence of those query params in the browser is **not implemented in these two repos**. |
| Customer purchase | **Store** creates the order and, on success, calls SDK `OrderCampaign`. That hits `POST /api/affiliate/purchase-campaign`. |
| Commission row | Affiliate server `purchaseOrderWithAffiliateCampaign` in `controllers/campaign/track-aff-container.js`. |
| Commission becomes spendable | Cron `cron/commissionPayoutJob.js` moves `PENDING`/`HOLD` to `PAID` and calls `addCommissionToWallet`. |
| Withdrawal | Portal `POST /api/user/withdrawal/new-withdrawal/:adminId`. Admin approves. Online payouts use Razorpay `POST https://api.razorpay.com/v1/payouts`. Webhook completes or fails the withdrawal. |

Simple sequence:

```
Affiliate registers on affiliate.uracca.com
        → OTP verified in the portal API
        → status stays PENDING until an admin sets APPROVED
        → affiliate selects a company (workingOn)
        → affiliate opens a product and starts a campaign
        → server stores Campaign + link
        → customer opens that link on the store
        → store calls TrackClick
        → customer pays on the store (COD or Razorpay — store code, not here)
        → store calls OrderCampaign with referralId, campaignAccessKey, orderId, productDetails
        → server writes a PENDING Commission
        → after campaign.returnPeriod + 1 days, cron sets PAID and credits Wallet.balanceAmount
        → affiliate requests withdrawal with a PIN
        → admin processes Razorpay payout or marks BANK completion
```

---

## 3. Architecture

```
Affiliate (browser)
        |
        |  Next.js portal
        v
affiliate.uracca.com          cookie aff_ses_tkn (NextAuth)
        |                     cookie aff_ses_server (affiliate JWT)
        |  HTTPS + credentials
        v
Affiliate Server  (Express, default port 8000)
https://affiliate.server.uracca.com/api     ← SDK default baseURL
        |
        +---------------------------+------------------------------+
        |                           |                              |
        v                           v                              v
MongoDB                     Store catalog HTTP              RazorpayX payouts
(shared with portal)        Platform.backendRoutes.products  + payout webhook
        ^
        |
Store server (NOT in this repo)
        |
        |  @haash/affiliate
        |  headers: x-api-key, x-domain
        v
POST /api/affiliate/clicks
POST /api/affiliate/purchase-campaign
PATCH /api/affiliate/cancel-amount/:orderId

Admin browser (NOT in this repo)
admin.uracca.com / {tenant}.admin.uracca.com
        |
        |  cookie aff-admin-tkn
        v
/api/admin/*  and  /api/user/admin-login
```

### Applications

#### Affiliate portal — URACCA Affiliate (user app)

| | |
| --- | --- |
| Purpose | Affiliate registration, dashboard, campaigns, earnings, wallet, tiers, settings |
| Technology | Next.js 15, React 19, NextAuth v5 beta, Redux Toolkit, TanStack Query, Mongoose, Tailwind 4 |
| Location | `/Users/haashimac/affiliate.uracca.com` |
| Production domain (from server CORS) | `https://affiliate.uracca.com` |
| Local | `next dev` default port **3000** (`README.md`). `next.config.ts` also allows `http://192.168.31.146:3000` and `http://192.168.188.244:3000` |
| Talks to | Same MongoDB for session, OTP, registration. Affiliate server via `BACKEND_URL` (axios `src/services/api/routes.ts`) |
| Auth | NextAuth JWT cookie `aff_ses_tkn` for pages. Affiliate-server cookie `aff_ses_server` for API calls |

#### Affiliate server

| | |
| --- | --- |
| Purpose | Affiliation API: users, campaigns, commissions, wallets, withdrawals, tiers, platforms |
| Technology | Node ESM, Express 5, Mongoose 8, JWT, bcryptjs, Razorpay SDK, node-cron |
| Location | `/Users/haashimac/affiliate.server` |
| Entry | `index.js` |
| Port | `process.env.PORT` or **8000**. Listens on `0.0.0.0` |
| Production API (SDK default) | `https://affiliate.server.uracca.com/api` in `haash-affiliate/src/config/config.js` |
| Auth | User JWT cookie `aff_ses_server` or `Authorization: Bearer`. Admin JWT cookie `aff-admin-tkn`. Store routes use `x-api-key` + `x-domain` |

#### SDK `@haash/affiliate`

| | |
| --- | --- |
| Purpose | Store calls click, purchase, and cancel without knowing route details |
| Location | `affiliate.server/haash-affiliate` |
| Functions | `InitAffiliate`, `TrackClick`, `OrderCampaign`, `CancelCommission` |
| Auth | Sends `x-api-key` and `x-domain` on every request |

#### URACCA Store

Not in this workspace. From CORS and link generation it is the customer site (`www.uracca.com`, `uracca.in`, tenant hosts such as `example.uracca.com` and `example.uracca.in`). It must:

1. Keep `aff` and `campKey` from the product URL.
2. Call `TrackClick`.
3. After its own order succeeds, call `OrderCampaign`.
4. On line-item cancel/refund, call `CancelCommission`.

How the store stores those query params (cookie vs localStorage) is **not in this code**.

#### Admin UI

Not in this workspace. Affiliate-server admin routes and CORS show it is expected at `admin.uracca.com` / `admin.uracca.in` and tenant hosts matching:

`https://{optional-www.}{optional-tenant.}admin.uracca.com|in`

#### Main commerce server

Not in this workspace. The affiliate server does not implement checkout. It only HTTP-GETs the product catalog URL stored on the platform, rewriting a path ending in `getAllProducts_admin` to `fetchNewProducts` unless `STORE_PRODUCTS_URL` is set (`utils/fetchPlatformProducts.js`).

#### MongoDB

One database is shared. The portal connects with `MONGODB_URL` (`src/lib/db/mongodb.ts`). The server connects with `MONGODB_URL` (`config/db.js`). Both define overlapping Mongoose models (`User`, `Campaign`, `Wallet`, and others). Schema drift between the two copies is a real maintenance risk.

#### Razorpay

Used here for **affiliate withdrawals**, not for customer checkout.

- Contact and fund account: `lib/RazorpayContactAndFund.js`
- Payout: `controllers/withdrawals/withdrawal-payout-controller.js` → `https://api.razorpay.com/v1/payouts`
- Webhook: `POST /api/web-hook/razorpay/withdrawal-payout`

#### Other external services

| Service | Used for |
| --- | --- |
| Media server | Document and image upload. `MEDIA_SERVER_URL`, `MEDIA_SERVER_UPLOAD_ORIGIN`, `MEDIA_SERVER_API_KEY` |
| Fast2SMS | Mobile OTP (`lib/otp-sender/index.js` and the portal copy) |
| SMTP (Nodemailer) | Email OTP |
| Cloudinary | Configured on the portal (`src/lib/cloudinary.ts`). Affiliate server lists Cloudinary keys as optional and does not show a Cloudinary client in the files inspected |

### Authentication mechanisms (summary)

| Caller | Mechanism |
| --- | --- |
| Affiliate browser → portal pages | NextAuth session cookie `aff_ses_tkn` |
| Affiliate browser → affiliate server | httpOnly cookie `aff_ses_server`, JWT signed with `JWT_SECRET_USER`, 7 days |
| Admin browser → affiliate server | httpOnly cookie `aff-admin-tkn`, JWT signed with `JWT_SECRET_ADMIN`, token `expiresIn: 7d`, cookie `maxAge` 30 days |
| Store → `/api/affiliate/*` | Headers `x-api-key` and `x-domain`, checked against `NpmPackage` |

---

## 4. Repository Structure

### Affiliate server

```
affiliate.server/
├── index.js                         Express app, CORS, route mounts, cron import
├── config/db.js                     Mongo connect + product-domain repair
├── config/rateLimitConfig.js
├── cron/commissionPayoutJob.js      PENDING/HOLD → PAID
├── haash-affiliate/                 @haash/affiliate SDK
│   └── src/{config,api,clicks,orders,wallet}
├── routes/                          Express routers
├── controllers/                     Request handlers
├── models/                          Mongoose schemas
├── middleware/                      JWT, API key, errors, upload, rate limit
├── services/tier/                   Tier progress engine
├── helper/                          Wallet, withdrawal settlement, cookies, domain
├── utils/                           TDS, encryption, product domain, OTP helpers
├── lib/                             Razorpay contact/fund, OTP sender
└── web-hook/razorpay/               Payout webhook
```

Important route mounts in `index.js`:

| Mount | Router |
| --- | --- |
| `/api/user` | `routes/user-route.js` |
| `/api/admin/withdrawal` | withdrawal router (admin handlers) |
| `/api/user/withdrawal` | same withdrawal router (user `POST /new-withdrawal/:adminId`) |
| `/api/admin/feedbacks` | feedback |
| `/api/admin/platform` | platform settings |
| `/api/admin/products` | product router |
| `/api/users/products` | **same** product router |
| `/api/admin/bulk-details` | charts / analysis |
| `/api/users/bulk-details` | **same** bulk router |
| `/api/admin/notifications` | admin notifications |
| `/api/admin/ticket` | call tickets |
| `/api/users/campaign` | campaigns |
| `/api/users/commission` | affiliate commission history |
| `/api/affiliate` | click, purchase, cancel (API key) |
| `/api/wallet` | wallets |
| `/api/npm` | register an SDK platform key |
| `/api/web-hook` | Razorpay payout webhook |
| `/api/tier` | tiers and rewards |

`app.use("/test/order", testRouter)` is commented out.

### Affiliate portal

```
affiliate.uracca.com/src/
├── app/                          App Router pages and Next API routes
│   ├── (auth)/login|register|forgot-password|forgot-pin
│   ├── dashboard, campaigns, earnings, wallet, products, settings, tier
│   ├── api/auth/*                login, register, OTP, logout (direct Mongo)
│   ├── api/user/*                password, avatar, withdrawal pin, feedback
│   └── api/admin/*               collaborate / list admins (direct Mongo, portal session)
├── middleware.ts                 NextAuth gate
├── app/auth.ts                   NextAuth Credentials provider
├── action/                       Server actions (auth, campaign, wallet, tier, …)
├── services/                     Axios wrappers → BACKEND_URL
├── models/                       Duplicate Mongoose schemas
├── providers/redux/              user, action, AffSettings slices
├── components/                   UI
└── utils/                        decrypt, share link, OTP, commission breakdown
```

The portal sidebar component `src/components/partials/sidebar/Sidebar_V01_List.tsx` still lists store paths (`/cart`, `/my-account/my-orders`). The affiliate navigation that is actually rendered for the portal is the mobile tab bar: Dashboard, Wallet, Earnings, Campaigns (`src/components/partials/footer/mobile-tab.tsx`).

---

## 5. Business Concepts

### Affiliate

A `User` document with `userType: "USER"`. Identified to the store by `referralId` (`AFF` + 2-digit year + 5 random digits, unique). Generated in `models/aff-user.js` `generateReferralId` on first save.

Stored in collection `users` (Mongoose model name `User`).

Who changes it: the affiliate (profile, pause), an admin (approval, commission type), registration code.

### Affiliate account vs approval

Registration creates the user with `status: "PENDING"` and `registrationVerified: false`. OTP verification sets `registrationVerified: true`. That is **not** approval. An admin must set `status: "APPROVED"` via `updateAffUserStatus`. `authenticateUser` rejects any `USER` whose status is not `APPROVED`, so a pending affiliate cannot call campaign, wallet, or commission APIs.

### Affiliate status

Enum in `models/enum.js` `statusEnum`:

`PENDING | APPROVED | REJECTED | BLOCKED | SUSPENDED | PAUSED`

Default `PENDING`.

Admin status endpoint only accepts `PENDING`, `APPROVED`, `REJECTED`, `BLOCKED`. `PAUSED` and `SUSPENDED` are set from the portal settings screen through `PUT /api/user/generic-update-user/:userId`.

`isBlocked` is a separate boolean. Login on the server checks `status === "BLOCKED"`, not `isBlocked`. NextAuth login checks `isBlocked`.

### Campaign

One affiliate, one company (admin), one product, one link. Model `Campaign` in `models/campaignSchema.js`.

### Campaign status

`ACTIVE | INACTIVE | PAUSED | ENDED | HOLD`. Default `ACTIVE` at creation. Admin updates it with `PATCH /api/users/campaign/:campaignId`.

Clicks and new commissions require `ACTIVE`. Other statuses are rejected with 403. The code does **not** create a `HOLD` commission when a campaign is paused. `HOLD` still exists as a commission status the cron can later pay if the campaign is `ACTIVE` again.

### Campaign access key

`campaignAccessKey`. Format from `utils/generate-keys.js`: `AFF_{last 6 digits of Date.now()}{6 hex chars}_CAMP`. Unique on `Campaign`. Also pushed onto `User.campaignAccessKey[]`.

This is the `campKey` query parameter.

### Affiliate referral ID

`User.referralId`. This is the `aff` query parameter. It is not the Mongo `_id`.

### Affiliate link

Built only in `createCampaign`:

```
{domain}products/{slug}?aff={referralId}&campKey={campaignAccessKey}
```

`domain` is sent by the portal. The portal uses `process.env.NEXT_PUBLIC_STORE_URL` or `http://localhost:3002/`. The string is concatenated with `products/` and **no slash is inserted**, so `domain` must already end with `/`.

Stored on `Campaign.campaignLink`.

### Product

Two different product identities exist:

| | Store catalog | Affiliate `Product` |
| --- | --- | --- |
| Where | HTTP JSON from `platform.backendRoutes.products` | Mongo model `Product` |
| Id used in campaign links | Store product `_id` is what the portal sends as `productId` when starting a campaign (`start-campain-button.tsx` uses `product._id`) | Field `productId` (string), unique together with `domain` |
| Commission | May include a `commission` field in the store payload | Field `commission` (number, percent) |
| Active | Not the source of truth for clicks | `isActive` and `status` (`ACTIVE` or `PAUSED`) |

If no local `Product` row exists, click and purchase gates that look up the local product do not block. Domain mismatch is checked only when a local row exists.

### Product eligibility

For a purchase, `getAndValidatePlatformProducts`:

- If a local product exists and its normalized domain ≠ platform domain → blocked, reason `Product domain mismatch`.
- If a local product exists and `isActive === false` or `status === "PAUSED"` → blocked, reason `Product inactive or paused`.
- If no local row exists, the line is treated as valid.
- If the store catalog fetch fails, the error is logged and the line can still pass on the local checks.

Then commission scope:

- `ONLY_AFF_PRODUCT` (default): only lines whose `productId` equals `campaign.product.productId`.
- `ALL_PRODUCT`: every valid line, but the campaign product must be among them.

If nothing remains, the handler throws `No valid active products found for this order` or `This product is not part of the current campaign`.

### Click

There is **no click document**. A successful track increments:

- `Campaign.clicks`
- `User.actions.totalClicks`
- `DailyAction.clicks` for that user, admin, and UTC/local date string `YYYY-MM-DD`
- Tier goal `CLICKS` by 1, if a platform exists (errors are logged and do not fail the request)

Every call increments. There is no deduplication, IP check, or time window.

### Order attribution

The affiliate server does not read the store order. Attribution is whatever the store sends: `referralId`, `campaignAccessKey`, `orderId`, `productDetails: [{ productId, productAmount }]`.

One commission per `orderId` (unique index). A repeat call returns 200 with `idempotent: true`.

### Commission

Model `Commissions`. Created as `status: "PENDING"`. Amount is a percentage of the summed `productAmount` values the store sent for eligible lines. TDS is subtracted to produce `finalCommission`.

### Commission status

`PENDING | HOLD | PAID | CANCELLED`. New rows are `PENDING`. Cron promotes `PENDING` and eligible `HOLD` to `PAID`. Cancel endpoint can set `CANCELLED` or reduce amounts.

### Reward

Tier levels define goals (`ORDERS`, `CLICKS`, `SALES`) and rewards (`SPIN` or `SCRATCHCARD`). Progress is `UserTierProgress`. When a level completes, a `TierRewardLog` is written by `services/tier/tierProgressEngine.js` (not fully expanded in this document; the claim and wallet credit paths were read).

### Collected reward

`TierRewardLog.collectedRewards[]`. The affiliate claims one reward from the log (`PUT /api/tier/user/claim/reward`). Status on the collected item: `PENDING | PROCESSING | PAID | CANCELLED`.

### Wallet

One `Wallet` per `(userId, adminId)`. `balanceAmount` is what the affiliate can withdraw. It increases when:

- the commission cron calls `addCommissionToWallet` (`finalCommission`), or
- an admin sets a cash collected reward to `PAID` (`addCashRewardToWallet`), or
- `PATCH /api/wallet/recharge/:userId/:adminId` (exposed to the logged-in user; the portal shows the button only when `NODE_ENV === "development"`).

It decreases when a withdrawal is requested (`balanceAmount -= requested amount`) and when a paid commission is reduced by cancel.

`pendingAmount` on the wallet is the net amount locked in open withdrawals, not pending commission. Pending commission lives on `User.commissionDetails.pendingCommission` and `Campaign.commissionDetails.pendingCommission`.

### Withdrawal

A `Withdrawals` document. Affiliate submits amount + PIN + method `BANK` or `ONLINE`.

### Payout

Admin `PATCH /api/admin/withdrawal/payout` sends a RazorpayX payout for a `PENDING` withdrawal and sets status `PROCESSING`. The webhook `payout.processed` completes it. Admin can also set `COMPLETED` directly via `PATCH /api/admin/withdrawal/action`.

### UPI

Stored on `User.transactionDetails` when `method === "UPI"` (`upiId`). Used when withdrawal `paymentMethod` is `ONLINE` and the user’s transaction method is `UPI`. Razorpay payout mode is `UPI`.

### Bank transfer

Two different bank objects exist:

- `User.transactionDetails.OnlineBank` — used for Razorpay fund accounts when method is `BANK` inside an `ONLINE` withdrawal.
- `User.withdrawalDetails.bank` — displayed on the portal withdraw screen for `withdrawalMethod === "BANK"`.

`processWithdrawal` creates a Razorpay contact only when `method === "ONLINE"`. A `BANK` withdrawal does not create a fund account. The Razorpay payout endpoint still requires `razorpayFundAccountId`, so a pure `BANK` withdrawal cannot be sent through `payWithdrawalToUser` unless those ids were already stored.

### Admin and Super Admin

Both are `User` documents. `userType` is `ADMIN` or `SUPER_ADMIN`. Each admin has a `Platform` (`adminId`) and usually a `domain` document.

`requireSuperAdminUnlessBootstrap`: if zero `SUPER_ADMIN` users exist, `POST /api/user/admin-register` is open. After that, only an authenticated super admin can register admins. If a super admin already exists and the body asks for `SUPER_ADMIN`, the new user is forced to `ADMIN`.

### Platform / domain / campaign platform / product domain

| Concept | Field | Meaning |
| --- | --- | --- |
| Domain document | `domain` collection, fields `name`, `url` | Registered store URL for an admin, created at admin registration |
| Platform | `Platform.domain` | Store base URL for that admin. Also holds commission, TDS, transfer fees, `backendRoutes.products` |
| Campaign platform | `Campaign.company.domain` and `Campaign.company.accountId` | Copy of the domain string sent at campaign creation, plus the admin id |
| Product domain | `Product.domain` | Store URL the affiliate product row belongs to. Compared with `normalizeStoreUrl` |
| SDK domain | `NpmPackage.domain` + header `x-domain` | Must match after host canonicalization (`www` ignored) |

`normalizeStoreUrl` trims and removes a trailing slash. It does **not** strip `www` or change host. `https://www.uracca.com` and `https://uracca.com` are different strings for product-domain checks. API-key checks use hostname without `www` (`canonicalHost` in `validatePlatformApiKey`).

---

## 6. Authentication

### Affiliate registration

Portal UI: `src/components/auth/register/register-page.tsx`, route `src/app/(auth)/register/[[...slug]]/page.tsx`.

Optional query `?referralId=` is appended to the form.

Server action `registerUserAction` in `src/action/auth/authAction.ts` posts to `AUTH_URL` (the portal’s own `/api/auth/register` when `AUTH_URL` points at the portal origin). Handler: `src/app/api/auth/register/route.ts`.

That route:

- Connects to Mongo with the portal’s `MONGODB_URL`.
- Uploads `documents` to the media server when files are present.
- Hashes the password with bcrypt (cost 10).
- Reuses an unverified draft (`utils/affiliateRegistrationDraft.js` on the server; the portal route has its own draft handling).
- Creates `User` with default `status` `PENDING`, `registrationVerified` false.
- If `referralId` matches a parent, increments `parent.referralCount` and creates a `Referring` row (`level: 1`). Referral does not pay commission by itself.
- Sends OTP via the portal OTP helper.

The affiliate server exposes a parallel `POST /api/user/user-register` (`controllers/auth/registration.controller.js` `registerUser`) with the same shape (multipart, up to 5 `documents`). The live portal register page does not call that server route.

### OTP

Portal:

- `POST /api/auth/send-otp` — send
- `POST /api/auth/verify-otp` — compare `user.otp`, check `user.otpExpiry`, set `registrationVerified: true`, clear OTP. On first verification, notify every `SUPER_ADMIN` with a `NEW_USER` notification.
- `POST /api/auth/verify-email-otp` — email verification path

OTP generation and Fast2SMS / SMTP live in `src/utils/otp-sender/index.ts` (portal) and `lib/otp-sender/index.js` (server). The OTP value is stored in plaintext on the user document.

`forgotPin` on verify-otp stores a hashed token and returns the raw token so the user can reset the withdrawal PIN (`/forgot-pin`).

Login is rejected until `registrationVerified` is true (both NextAuth `login()` in `src/app/auth.ts` and server `loginUser`).

### Password

bcryptjs, cost 10, on register. Compared with `bcrypt.compare` on login. Change password: portal `src/app/api/user/update/password/route.ts`. Server login does not implement a separate forgot-password email flow in the routes that were read; the portal has a page `src/app/(auth)/forgot-password/page.tsx`.

### Login request flow

```
LoginPage
  → POST {BACKEND_URL}/api/user/user-login     (controllers/auth/auth-controller.js loginUser)
       → User.findOne({ mobile })
       → reject BLOCKED, reject if !registrationVerified
       → bcrypt.compare
       → jwt.sign(JWT_SECRET_USER, expiresIn 7d)
       → Set-Cookie aff_ses_server (httpOnly, sameSite lax, domain from Origin)
  → next-auth signIn("credentials", { mobile, password })
       → src/app/auth.ts authorize → same Mongo user
       → Set-Cookie aff_ses_tkn
  → window.location = /dashboard
```

`aff_ses_server` is what `authenticateUser` reads. `aff_ses_tkn` is what `src/middleware.ts` / NextAuth reads for page access.

Cookie domain (`helper/req-call.js` `getCookieDomain`): localhost gets no `Domain` attribute. Otherwise it is `.{sld}.{tld}` from the **request Origin** (last two hostname labels). From `https://affiliate.uracca.com` that is `.uracca.com`, so the cookie is sent to `affiliate.server.uracca.com`. It is not sent to a host outside `.uracca.com`.

There is a second login route on the portal, `POST /api/auth/login`, which signs with `process.env.JWT_SECRET` (fallback string `supersecretkey`) and also sets `aff_ses_server`. The login page does **not** call it. If something else does, that token will not verify on the affiliate server unless `JWT_SECRET` equals `JWT_SECRET_USER`.

### Current user

Page session: NextAuth `session` callback reloads the user from Mongo by `token.id` and attaches wallet + daily actions (`serializeUser` in `src/app/auth.ts`).

`src/services/user/route.ts` calls `GET /api/user/current-user`. **That route does not exist.** The server only has `GET /api/user/current-admin` (`authenticateAdmin`). A search shows `get_current_user_Api` is defined and not imported elsewhere.

### Admin authentication

`POST /api/user/admin-login` with `{ mobile, password, domain }`.

- Rejects `userType === "USER"`.
- JWT payload `{ adminId, mobile, email, domain }`, secret `JWT_SECRET_ADMIN`, 7 days.
- Cookie `aff-admin-tkn`, `sameSite: "Strict"`, `maxAge` 30 days.
- Loads `Platform` by `adminId` and `domain`.

`authenticateAdmin` (`middleware/middleware.js`):

- Reads `aff-admin-tkn` or `Authorization: Bearer`.
- User must be `ADMIN` or `SUPER_ADMIN`.
- Non-super-admins must have `status === "APPROVED"`. Super admins skip that status check.

Logout: `POST /api/user/logout-admin` clears admin cookies (`controllers/user/user-controller.js`).

### Affiliate logout

Settings calls `logoutClientAction` then `signOut` to `/login`. Portal logout route: `src/app/api/auth/logout/route.ts` (clears cookies, uses `COOKIE_DOMAIN` when set).

### Protected routes

Portal middleware matcher (`src/middleware.ts`): `/`, `/login`, `/register`, `/forgot-password`, `/dashboard`, `/wallet`, `/earnings`, `/campaigns`, `/products`, `/settings`, `/forgot-pin`.

Rules in `src/app/authConfig.ts`:

- Logged-in users hitting `/` or `/login` go to `/dashboard`.
- Protected routes without a session go to `/login`.
- If the DB user is missing or `status === "BLOCKED"`, cookies `aff_ses_tkn` and `aff_ses_server` are deleted and the user is sent to `/login`.
- If `campaignStarted` is false, every protected path except `/dashboard` redirects to `/dashboard`.

`/tier` is listed in `protectedRoutes` inside `authConfig.ts` but is **not** in the middleware `matcher`, so the Next.js middleware does not run the auth callback for `/tier` unless another matcher covers it. It does not.

Server protection is per-route via `authenticateUser` / `authenticateAdmin`. `authenticateUser` returns 403 when a `USER` is not `APPROVED`.

### Token expiration

| Token | JWT `expiresIn` | Cookie maxAge |
| --- | --- | --- |
| Affiliate `aff_ses_server` | 7 days | 7 days |
| Admin `aff-admin-tkn` | 7 days | 30 days |
| NextAuth `aff_ses_tkn` | 7 days (`auth.ts` `session.maxAge` and `jwt.maxAge`) | production `secure: true` |

Admin cookie can outlive the JWT. After 7 days the cookie is still sent and `jwt.verify` fails with “Invalid or expired token.”

---

## 7. Affiliate Lifecycle

Statuses that exist on the user document:

```
PENDING  (default at register)
   │
   ├─ APPROVED     admin update-status
   ├─ REJECTED     admin update-status
   └─ BLOCKED      admin update-status, or the affiliate “delete account” switch

From APPROVED the portal can set:
   PAUSED      toggle back to APPROVED
   SUSPENDED   toggle back to APPROVED
```

`updateAffUserStatus` will not set `APPROVED` unless `registrationVerified` is true.

| Status | Campaign APIs (`authenticateUser`) | New clicks | New commissions | Withdrawal (`checkUserStatus`) | Existing commissions |
| --- | --- | --- | --- | --- | --- |
| `PENDING` | 403 | 403, not counted | 404 `user status is : PENDING` | Allowed by `checkUserStatus` if not blocked, but `authenticateUser` already blocks the withdrawal route | Unchanged. Cron can still pay them if a commission exists |
| `APPROVED` | Allowed | Counted if campaign and product gates pass | Created if campaign is `ACTIVE` | Allowed | Normal |
| `REJECTED` | 403 | Not counted | Not created | `authenticateUser` blocks first | Existing rows are not auto-cancelled |
| `BLOCKED` | 403. Server login also rejects this status | Not counted | Not created | Blocked by auth | Not auto-cancelled |
| `PAUSED` | 403 (not `APPROVED`) | Not counted | Not created | `checkUserStatus` returns 403 “account is paused” | Not auto-cancelled. Cron does not check user status |
| `SUSPENDED` | 403 | Not counted | Not created | 403 “account is suspended” | Not auto-cancelled |
| `isBlocked: true` | Not checked by `authenticateUser` | Not checked by click handler | Not checked inside purchase (purchase checks `status`) | 403 if `checkUserStatus` runs | — |

`checkUserStatus` does **not** treat `PENDING`, `REJECTED`, or `BLOCKED` as stop conditions. It only stops `isBlocked`, `SUSPENDED`, and `PAUSED`. Purchase has its own `status !== "APPROVED"` check. Click tracking also requires `APPROVED`.

Self-service “delete account” sets `status` to `BLOCKED`. It does not delete the document. `updateAffUser` refuses further generic updates when status is already `REJECTED` or `BLOCKED`, but that branch references `res`, which is not in scope, so it throws `ReferenceError` instead of returning a clean 400. See Known Issues.

Pausing an affiliate does not change campaign status and does not cancel commissions.

---

## 8. Affiliate Admin

The admin **screens** are not in these repositories. This section is the API the admin UI is expected to call. All of these use `authenticateAdmin` unless noted.

### Login

| | |
| --- | --- |
| API | `POST /api/user/admin-login` |
| Body | `{ mobile, password, domain }` |
| Controller | `loginAdmin` |
| Cookie | `aff-admin-tkn` |
| Also returns | `token`, `user`, `platform` |

`GET /api/user/current-admin` → `getCurrentUsers`.

`POST /api/user/logout-admin`.

`POST /api/user/admin-register` → `registerAdmin`. Open only when no super admin exists; otherwise super admin only. Body `{ mobile, password, email, domain, type }`. Creates `domain`, `User`, and `Platform`. Does **not** create `NpmPackage` (that block is commented out). An API key is created later when platform settings are saved and `platform.domain` is set with no `accessKey` (`updatePlatformSettings`).

### Dashboard / reports

| API | Handler | Purpose |
| --- | --- | --- |
| `GET /api/admin/bulk-details/` | `bulkDataController` | Affiliate list data for the admin |
| `GET /api/admin/bulk-details/chart-data` | `getEarningChartDataController` | Admin earning chart |
| `GET /api/admin/bulk-details/user-chart-data/:userId` | `getUserChartDataController` | One affiliate’s chart |
| `GET /api/admin/bulk-details/all-user-chart` | `getAllUsersChartDataUnderAnAdminController` | All affiliates under the admin |
| `GET /api/admin/bulk-details/analysis` | `getAffiliatePerformanceTable` | Performance table |
| `GET /api/admin/bulk-details/members/analysis/:userId` | `analysisTablesOfUserInAdmin` | One member |

Affiliate-facing chart (not admin): `GET /api/users/bulk-details/user-chart-data?period=&type=` with `authenticateUser`.

### Affiliate management

| API | Purpose |
| --- | --- |
| `GET /api/user/all` | Affiliates for this admin (`getAllAffUsersForEachAdmins`) |
| `PUT /api/user/update-status/:userId` | Set status and `affType` (`type`, `commission`, `commissionType`, `tdsType`, `isTdsEnabled`). `SPECIAL` and `COMPANY` cannot be approved with `commission === 0` |
| `PUT /api/user/generic-update/:userId` | Admin generic `$set` |
| `GET /api/user/all-admins` | **Affiliate** token, not admin. Used so an affiliate can list admins to collaborate with |

Portal-side collaboration (direct Mongo, NextAuth, not the affiliate server):

- `src/app/api/admin/all-admins/route.ts`
- `src/app/api/admin/collaborate/route.ts`
- `src/app/api/admin/collaborate/workingOn/route.ts` sets `User.workingOn`

`workingOn` is required before `createCampaign`. The campaign `accountId` must equal `workingOn`.

### Products

Mounted at `/api/admin/products` **without** `authenticateAdmin` on the router. See Security.

| API | Handler |
| --- | --- |
| `GET /api/admin/products?domain=&status=` | `getProductsFromDb` |
| `POST /api/admin/products` | `updateProductsToDb` body `{ products: [{ productId, domain, ...fields }] }` |
| `PATCH /api/admin/products/:id` | `updateProductCommission` body `{ commission }` |
| `PATCH` path `updateStatus/:id` | `updateProductStatus` body `{ status, isActive }`. The route string has **no leading slash**. Intended URL is uncertain; the comment in the controller says `PATCH /api/products/:id/status`, which is not how the router is mounted |

Same handlers are also reachable at `/api/users/products/...`.

### Campaigns

| API | Auth | Purpose |
| --- | --- | --- |
| `PATCH /api/users/campaign/:campaignId` | Admin | `genericUpdateCampaigns`. Body is `$set` onto the campaign. Must be owned by `company.accountId === admin._id` |
| `GET /api/users/campaign/admin/activeCampaigns/:userId` | Admin | `getUserCampaigns` for that user. Admin sees inactive campaigns. Response `data` is AES-encrypted |

### Orders and commissions

There is no admin “list store orders” API in this server. Commissions are the order record. Affiliates read them at `GET /api/users/commission/all` and `/summary`. Admin visibility of commissions is through bulk/analysis controllers and campaign `commissionRecords`, not a dedicated admin commission router.

Cancel from the store: `PATCH /api/affiliate/cancel-amount/:orderId` with `{ productId }` (API key, not admin JWT).

### Rewards

| API | Auth |
| --- | --- |
| `POST /api/tier/` | Admin create tier |
| `PUT /api/tier/:tierId` | Admin update |
| `DELETE /api/tier/delete/:tierId` | Admin delete |
| `PATCH /api/tier/toggle/:tierId` | Active flag |
| `GET /api/tier/all` and `GET /api/tier/` | List |
| `GET /api/tier/:tierId` | One tier |
| `GET /api/tier/admin/user-tier/:userId` | Progress |
| `GET /api/tier/admin/rewards` | Reward logs for the admin’s users |
| `PATCH /api/tier/admin/reward/update/:rewardLogId` | Update collected reward. Moving a cash reward to `PAID` credits the wallet once |

### Payouts

| API | Purpose |
| --- | --- |
| `GET /api/admin/withdrawal/all` | History |
| `PATCH /api/admin/withdrawal/action` | Body `{ withdrawalId, status, rejectReason }`. Status `PROCESSING`, `COMPLETED`, `REJECTED`, `CANCELLED` |
| `PATCH /api/admin/withdrawal/payout` | Body `{ withdrawalId }`. RazorpayX payout, only from `PENDING` |

### Platform

| API | Auth | Purpose |
| --- | --- | --- |
| `GET /api/admin/platform/` | Admin | This admin’s platform |
| `PUT /api/admin/platform/update` | Admin | Body `{ updateFields }`. Normalizes `domain`. Creates `NpmPackage` and stores `accessKey` if missing |
| `POST /api/admin/platform/general/settings` | Admin | Theme / media settings (`Settings` model) |
| `GET /api/admin/platform/general/settings` | **No auth on the route** | `getAffGeneralSettings` |
| `GET /api/admin/platform/platformToUser/:adminId` | Affiliate JWT | Platform the affiliate reads for fees and withdrawal rules |

### Other admin APIs

| API | Purpose |
| --- | --- |
| `GET /api/admin/notifications/all` | Notifications |
| `DELETE /api/admin/notifications/delete` | Delete |
| `PATCH /api/admin/notifications/markAsRead/:nId` | Read |
| `GET /api/admin/feedbacks/` | Feedback list |
| `GET/PATCH/DELETE /api/admin/feedbacks/:id` | One feedback |
| `POST /api/admin/ticket/call` | **No auth.** Public schedule-a-call |
| `GET /api/admin/ticket/all` | Admin list |
| `GET /api/wallet/` | All wallets (admin) |
| `GET /api/wallet/:adminId` | Wallets for one admin |

`POST /api/npm/register` creates an `NpmPackage` and **sets every existing package `active: false`**. It has no authentication.

---

## 9. Products

### How a product becomes available to affiliates

1. An admin (or a sync job) posts products to `POST /api/admin/products` or the product is inserted by `upsertAffiliateProduct`.
2. The store catalog URL is saved on `Platform.backendRoutes.products`.
3. The portal calls `GET /api/users/products/newCampaign/:adminId`.
4. The server GETs that URL (public catalog; `getAllProducts_admin` is rewritten to `fetchNewProducts`).
5. Each external product is kept unless a local `Product` with `productId === external._id` has `isActive === false`.
6. Commission shown on the card:
   - If `affType.type !== "INDIVIDUAL"`, use `affType.commission`, else platform commission.
   - If `INDIVIDUAL` and local `commission > 0`, use local commission, else platform commission.
7. Products that already have an `ACTIVE` campaign for this user are flagged `campaignProduct: true`. The start button hides itself when that flag is set.

Local `status: "PAUSED"` is **not** filtered in this list. Only `isActive === false` hides the product. Click and purchase gates treat either `isActive === false` or `status === "PAUSED"` as blocked, but the purchase gate looks up `Product.findOne({ productId })` **without domain**, so the first matching row wins.

Filters on the user product API: `categoryId`, `productId`, `color`, `size`, `minPrice`, `maxPrice`, `sort` (`price_asc`, `price_desc`, `best_selling`).

Portal: `src/services/products/route.ts` → `get_new_campaign_products_api`. Page `src/app/products/[slug]/page.tsx`. Start control `src/components/pages/products/start-campain-button.tsx`.

---

## 10. Campaigns

### Creation

`PUT /api/users/campaign/create` — `createCampaign`.

Auth: affiliate JWT, account must be `APPROVED`.

Body:

```json
{
  "productId": "store product _id",
  "slug": "product-slug",
  "domain": "https://www.uracca.com/",
  "returnPeriod": 7,
  "accountId": "admin ObjectId (must equal user.workingOn)",
  "title": "Product name",
  "image": "https://...",
  "mrp": 1000,
  "category": "Category name",
  "categoryId": "category id"
}
```

Effects:

- New `Campaign` with `status: "ACTIVE"`.
- `campaignAccessKey` generated.
- `campaignLink` stored.
- `$addToSet` on the user: `campaignAccessKey`, `campaignId`.
- `DailyAction.activeCampaigns` + 1.
- Admin notification `CAMPAIGN_CREATED`.

It does not check that the product is active, that the domain matches `Platform.domain`, or that the affiliate does not already have a campaign for that product. The UI hides the button when `campaignProduct` is true; the API does not.

### Read

`GET /api/users/campaign?accountId=&date=newest|oldest&sort=high|low&campaignId=`

Affiliate responses omit campaigns with `status === "INACTIVE"` and products with `isActive === false`. `PAUSED` campaigns are still returned. Payload `data` is encrypted (`encryptData`). The portal decrypts with `NEXT_PUBLIC_DATA_SECRET_KEY` (`src/utils/crypt-data.ts`), which must be the same 64-hex-character key as server `DATA_SECRET_KEY`.

### Edit / deactivate

There is no affiliate “edit campaign” route. Admin `PATCH /api/users/campaign/:campaignId` `$set`s the body. Sending `{ "status": "PAUSED" }` pauses it. There is no hard delete route.

Status changes notify the admin when the new status maps through `campaignActionFromStatus`.

### Ids on a campaign

| Field | Role |
| --- | --- |
| `_id` | Campaign id |
| `userId` | Affiliate |
| `company.accountId` | Admin / platform owner |
| `company.domain` | Domain string supplied at creation |
| `campaignAccessKey` | `campKey` |
| `product.productId` | Store product id string |
| `returnPeriod` | Days before the cron may pay. `0` or missing becomes `1` in the cron (`\|\|` treats 0 as missing) |

---

## 11. Affiliate Links

Generated only in `controllers/campaign/campaign-controller.js`:

```
{domain}products/{slug}?aff={referralId}&campKey={campaignAccessKey}
```

| Param | Meaning | Generated | Stored |
| --- | --- | --- | --- |
| `aff` | `User.referralId` | On user save | `users.referralId` |
| `campKey` | `Campaign.campaignAccessKey` | `generateUniqueCampaignAccessKey` | `campaigns.campaignAccessKey` and `users.campaignAccessKey[]` |

The portal does not parse these params. It only displays and copies `campaignLink` (`useShareLink` in `src/utils/shareLink.ts`: clipboard, WhatsApp, Telegram, Facebook).

The store must:

1. Read `aff` and `campKey` from the URL.
2. Keep them until checkout (mechanism not in this repo).
3. Call `TrackClick({ referralId: aff, campaignAccessKey: campKey })`.
4. Send the same pair on `OrderCampaign`.

SDK:

```js
import { InitAffiliate, TrackClick, OrderCampaign } from "@haash/affiliate";

InitAffiliate({
  domain: "https://www.uracca.com",
  apiKey: "<NpmPackage.apiKey>",
  baseURL: "https://affiliate.server.uracca.com/api", // optional; this is the default
});

await TrackClick({ referralId: "AFF2601234", campaignAccessKey: "AFF_123456ABCDEF_CAMP" });
```

`InitAffiliate` requires `domain` and `apiKey`. `baseURL` is optional and trailing slashes are stripped. Default base URL is `https://affiliate.server.uracca.com/api`.

### Domain / platform on the link

The link host is whatever `NEXT_PUBLIC_STORE_URL` (or the fallback `http://localhost:3002/`) was at click-the-button time. It is **not** read back from `Platform.domain` inside `createCampaign`. If the env URL and `Platform.domain` differ, the link and the platform row disagree.

API-key domain check (`validatePlatformApiKey`):

- Requires headers `x-api-key` and `x-domain`.
- `NpmPackage` must exist for that key.
- Localhost / `127.0.0.1` in Origin or `x-domain` skips the host compare.
- Otherwise `canonicalHost(x-domain)` must equal `canonicalHost(NpmPackage.domain)` (`www` stripped).
- Browser `Origin` is not compared to the package domain. CORS is a separate allow-list.

So a store on `www.example.uracca.in` can call the API with `x-domain` set to the package’s canonical domain even if the page host differs. A mismatched `x-domain` returns `Domain mismatch` (`InvalidError`, HTTP 401).

---

## 12. Click Tracking

```
Affiliate link on the store
    → store reads aff + campKey          (store code, not here)
    → TrackClick()
    → POST /api/affiliate/clicks
         headers: x-api-key, x-domain, Content-Type
         body: { referralId, campaignAccessKey }
    → validatePlatformApiKey
    → trackAffiliateClick
    → increments counters
```

There is no `checkUserStatus` on the click route. The handler itself requires `user.status === "APPROVED"` and `campaign.status === "ACTIVE"`.

### Request

`POST /api/affiliate/clicks`

```json
{ "referralId": "AFF2601234", "campaignAccessKey": "AFF_482193A1B2C3_CAMP" }
```

### Responses

| Case | Result |
| --- | --- |
| Missing fields, unknown referral, key not on the user | `next(error)` → 500 `UnknownError` (these are plain `Error`, no `statusCode`) |
| Campaign not found | 404 `{ message: "Campaign not found" }` |
| User not `APPROVED` | 403 `Affiliate user is {status}; clicks are not tracked` |
| Campaign not `ACTIVE` | 403 `Campaign is {status}; clicks are not tracked` |
| Local product inactive or paused | 403 `Product is paused or inactive; clicks are not tracked` |
| Success | 200 `{ success, message, campaignClicks, totalUserClicks }` |

### Duplicate clicks

Not handled. Each request adds 1.

### If tracking fails

The handler does not write a failed-click row. The store order can still be created later. A failed click does not block a later `purchase-campaign` call. Tier click increment failures are logged and the HTTP response is still 200 if the counters were saved.

---

## 13. Order Attribution

This server never sees the cart. Attribution is the body of `POST /api/affiliate/purchase-campaign`.

```
1. Customer opens ?aff=&campKey=          store
2. Store keeps those values               store (not in this repo)
3. Customer checks out                    store
4. Store creates the order                store
5. Store calls OrderCampaign              SDK → this server
6. Server validates user, key, campaign, product lines
7. Server inserts Commissions { orderId unique }
```

Local storage keys for `aff` / `campKey` do **not** exist in the affiliate portal. Do not look for them there.

### Purchase body

```json
{
  "referralId": "AFF2601234",
  "campaignAccessKey": "AFF_482193A1B2C3_CAMP",
  "orderId": "OD0000000000000001",
  "productDetails": [
    { "productId": "665f0c0c0c0c0c0c0c0c0c0c", "productAmount": 1000 }
  ]
}
```

`productAmount` is used as given. This server does not recompute GST, shipping, coupons, or MRP.

### Handler

`purchaseOrderWithAffiliateCampaign` in `controllers/campaign/track-aff-container.js`.

Middleware on the route: `validatePlatformApiKey`, then `checkUserStatus`. `checkUserStatus` needs `referralId` or a user id. It blocks only blocked / suspended / paused users. The handler then requires `APPROVED`.

Validation order:

1. Required fields and non-empty `productDetails`.
2. Existing `Commissions.orderId` → 200 idempotent, no second increment.
3. User exists and `status === "APPROVED"`.
4. Key is in `user.campaignAccessKey` and a campaign matches key + `userId`.
5. Campaign `status === "ACTIVE"`.
6. If a local product exists for `campaign.product.productId` and is inactive/paused → 403, no commission.
7. Load platform by `campaign.company.accountId`.
8. `getAndValidatePlatformProducts`.
9. Scope lines by `affType.commissionType`.
10. Resolve percent, compute amounts, `CalculateTDS`, `Commissions.create`.
11. Increment campaign and user commission totals and `ordersCount` / `actions.totalOrders`.
12. DailyAction `orders` + 1. Tier goal `ORDERS` + 1 (failure is logged only).

`sales` on `DailyAction` is not incremented in this function.

Duplicate key race (`11000`) returns the same idempotent 200.

---

## 14. COD Order Flow

The affiliate server does not have a COD branch. `utils/enum.js` defines `PaymentMethodEnum.COD` and `RAZORPAY` on the unused `Order` model (`models/uracca-order.js`). That model is imported only by `controllers/testings-controllers.js`. The test route is commented out in `index.js`.

What actually happens for COD, as far as this code can say:

```
Customer chooses COD on the store          (store, not here)
    → store creates the order              (store, not here)
    → store calls OrderCampaign            (same endpoint as prepaid)
    → commission PENDING
```

If `OrderCampaign` throws, this server returns an error and does not create a commission. It cannot roll back the store order, because it did not create it. Whether the store still keeps the order when the affiliate call fails is **store behaviour and was not verified here**.

The affiliate endpoint does not look at payment method. COD and prepaid are the same function.

---

## 15. Razorpay Order Flow

### Customer checkout

Not implemented in the affiliate server. There is no Razorpay order create, no payment signature check, and no checkout webhook for customer orders.

The intended split is:

```
Customer pays on the store
    → store verifies Razorpay signature     (store, not here)
    → store creates the order               (store, not here)
    → store calls OrderCampaign             (affiliate server)
```

A failed payment should never call `OrderCampaign`. A successful payment whose affiliate call fails still leaves the store order in place and leaves no commission here. Those are separate failures.

`orderId` stored on the commission is the store’s order id string, not a Razorpay order id, unless the store chooses to send the Razorpay id. The field is an opaque unique string.

### Razorpay inside this system (withdrawals only)

See section 18. Signature verification exists for the **payout webhook** (`RAZORPAY_WEBHOOK_SECRET`), not for customer checkout.

---

## 16. Commission System

### When and who

Created inside `purchaseOrderWithAffiliateCampaign` when the store calls `POST /api/affiliate/purchase-campaign` and every gate passes. Status `PENDING`. Not created on click.

### Calculation

```
commissionPercent =
  user.affType.commission          if > 0
  else first eligible line's local Product.commission if > 0
  else first eligible line's store payload commission if > 0
  else platform.commission
  else error "No commission defined for this order"

commissionAmount = commissionBaseAmount * commissionPercent / 100
```

`commissionBaseAmount` is the sum of eligible `productAmount` values (`ONLY_AFF_PRODUCT`) or `totalValidAmount` (`ALL_PRODUCT`).

TDS (`CalculateTDS` in `controllers/campaign/calculateTDS.js`):

- If `affType.isTdsEnabled` is false → TDS 0, `finalCommission = commissionAmount`.
- If `tdsType === "LINKED"` use `platform.tdsLinkedMethods`, else `tdsUnLinkedMethods`.
- `PERCENT`: `commissionAmount * amount / 100`. `FIXED`: the configured amount (not capped in code).
- `finalCommission = commissionAmount - tdsAmount`. Negative results are not clamped here.

### What is stored

| Field | Meaning |
| --- | --- |
| `orderId` | Unique store order id |
| `adminId` | `campaign.company.accountId` |
| `userId` | Affiliate |
| `campaignId` | Campaign |
| `purchaseAmount` | Commission base (eligible lines only) |
| `commissionAmount` | Gross commission before TDS |
| `tdsAmount` | TDS |
| `finalCommission` | Net |
| `commissionPercent` | Percent used |
| `blockedAmount` | Present on the schema, not set by the purchase handler |
| `productDetails[]` | `{ productId, productAmount, status: ACTIVE }` for eligible lines only |
| `status` | `PENDING` at create |

Campaign and user `commissionDetails.pendingCommission` increase by `finalCommission` (net), while `totalCommission` increases by the gross `commissionAmount`.

### Lifecycle

```
PENDING  ──cron, after returnPeriod+1 days──►  PAID  ──cancel of a paid row──► amounts reduced, or CANCELLED
   │
HOLD     ──cron, only if campaign is ACTIVE and the same day rule──► PAID
   │
CANCELLED   (all eligible product lines cancelled, or remaining purchase is 0)
```

The purchase handler never writes `HOLD`. Historical `HOLD` rows can still be paid by the cron.

Cron (`cron/commissionPayoutJob.js`), schedule `* * * * *` (every minute):

- Loads `PENDING` and `HOLD`.
- Skips missing campaign.
- Skips `HOLD` while campaign status is not `ACTIVE`.
- `returnPeriod` from the campaign; if falsy, uses `1`.
- Pays when whole days since `createdAt` `>= returnPeriod + 1`.
- Atomic `findOneAndUpdate` to `PAID`.
- `addCommissionToWallet` adds `finalCommission` to `balanceAmount`, `totalAmount`, and `commissionAmount`.
- Moves campaign pending → paid.
- Does **not** update `User.commissionDetails` or `User.payouts` (comment in the cron says wallet + commission + campaign are the live sources).
- Writes a commission notification.

Wallet transaction pushed by `addCommissionToWallet` is stored with `status: "PENDING"` even though the commission is `PAID`. `markCommissionPaid` exists in `helper/wallet.js` and is not called by the cron.

Cancelling a line: `PATCH /api/affiliate/cancel-amount/:orderId` body or query `productId`. `cancelWalletCommissionAmountFromAff` marks that `productDetails` row `CANCELLED`, recomputes commission and TDS by the original percent (TDS scaled by remaining purchase / original purchase), and:

- `PENDING` or `HOLD`: reduces pending totals on user and campaign.
- `PAID`: reduces wallet `balanceAmount` and increases `cancelledAmount`.
- Full cancel: status `CANCELLED`, decrements `ordersCount` and `actions.totalOrders`, decrements that day’s `DailyAction.orders`.

It does not change the store order.

### Affiliate reads

`GET /api/users/commission/all?period=all|6month|this-month|this-year&sort=newest|oldest&campaignId=`

`GET /api/users/commission/summary`

Both require an approved affiliate with `workingOn` set. List payload is encrypted. Summary excludes `CANCELLED`.

---

## 17. Rewards and Wallet

### Wallet fields (`models/walletSchema.js`)

| Field | Meaning in code |
| --- | --- |
| `totalAmount` | Increased by paid commission net. Not increased by cash rewards |
| `commissionAmount` | Same increment as `totalAmount` on commission payout |
| `balanceAmount` | Available to withdraw. Commission payout, cash reward, recharge, minus withdrawals and paid-commission cancellations |
| `pendingAmount` | Net locked in open withdrawals |
| `paidAmount` | Completed withdrawal nets (see `completeWithdrawal`) |
| `cancelledAmount` | Cancelled commission amounts taken back from a paid commission |
| `transactions[]` | `COMMISSION`, `WITHDRAWAL`, `REFUND`, `RECHARGE`, `REWARD` |
| `recharge` | `{ rechargeAmount, type: LOCAL\|PRODUCTION, date }` |

Unique index `{ userId: 1, adminId: 1 }`.

The portal shows `session.user.wallet`, loaded in NextAuth from `Wallet.findOne({ userId, adminId: workingOn })`.

### From commission to spendable balance

```
Order attributed
    → Commission PENDING
    → user/campaign pendingCommission += finalCommission
    → wallet.balanceAmount unchanged

returnPeriod + 1 days
    → Commission PAID
    → wallet.balanceAmount += finalCommission
```

Until the cron runs, earnings screens that read commission rows show pending money, and the wallet balance does not include it.

### Tier rewards

Goals increment on click (`CLICKS`) and on attributed order (`ORDERS`). `SALES` is a goal type on the schema. The purchase handler does not call `incrementGoal("SALES", ...)`.

Affiliate:

- `GET /api/tier/user/my-tier`
- `GET /api/tier/user/allMyRewards`
- `GET /api/tier/user/my-rewards/:id`
- `PUT /api/tier/user/claim/reward` body `{ rewardLogId, rewardId }`

Claim pushes a `collectedRewards` item and does not immediately credit cash.

Admin `PATCH /api/tier/admin/reward/update/:rewardLogId`: when a collected item with `rewardType === "CASH"` or `valueType === "currency"` moves to `PAID`, `addCashRewardToWallet` adds `value` to `balanceAmount` once (matched by `transactions.refId`). It does not change `commissionAmount`. A `PAID` reward cannot be moved back to `PENDING` or `PROCESSING`.

Portal pages: `/tier`, `/tier/rewards`, `/tier/rewards/[rewardId]`.

`POST /api/dev/tier-click` exists and refuses to run unless `NODE_ENV === "development"`. The tier page shows a button for it in development.

---

## 18. Payout and Withdrawal

### Request

`POST /api/user/withdrawal/new-withdrawal/:adminId`

Auth: approved affiliate. `checkUserStatus` also blocks paused, suspended, and `isBlocked`.

Body: `{ amount, withdrawalPin, method }` where `method` is `BANK` or `ONLINE`.

Steps in `processWithdrawal`:

1. PIN must match `bcrypt.compare` against `user.withdrawalDetails.withdrawalPin`.
2. Wallet for `(userId, adminId)` must exist and `balanceAmount >= amount`.
3. Platform must exist.
4. Transfer charge:
   - `BANK` uses `platform.bankTransfer` if `enabled`.
   - `ONLINE` uses `platform.onlineTransfer` if `enabled`.
   - `FIXED` subtracts `transferCharge`. `PERCENT` subtracts `amount * transferCharge / 100`.
5. Net must be `> 0`.
6. `ONLINE` only: ensure Razorpay contact + fund account (`createRazorpayContactAndFund`). UPI vs bank comes from `user.transactionDetails.method`.
7. `balanceAmount -= amount` (the gross request). `pendingAmount += finalAmount` (the net).
8. Create `Withdrawals` with `requestedAmount = amount`, `withdrawalAmount = net`, `transferCharge = amount - net`, `tdsAmount: 0`, `status: PENDING`.

TDS is not applied again at withdrawal. It was already taken on the commission.

### Minimum and maximum

`Platform.paymentMethods`:

| `type` | Intended UI |
| --- | --- |
| `MONTHLY` | Portal wallet page treats this as “not a free-form withdraw” (`wallet-page.tsx`) |
| `LIMITED` | User must pick one of `paymentMethods.amount[]` |
| `ENTER` | User types an amount; UI checks `minAmount` and `maxAmount` |

Those checks are in `choose-withdrawal-amount.tsx`. **`processWithdrawal` does not read `paymentMethods`.** A client that skips the UI can submit any positive amount the balance allows.

### Statuses

`PENDING → PROCESSING → COMPLETED`

Also `REJECTED`, `CANCELLED`, `FAILED`, `REVERSED`.

| Action | Wallet effect |
| --- | --- |
| Request | Balance down by requested amount. Pending up by net |
| `PROCESSING` (admin action or payout API) | Status only. Pending stays locked |
| `COMPLETED` | `completeWithdrawal` in `helper/withdrawalWallet.js` settles paid vs pending. Idempotent via `accountingApplied` |
| `REJECTED` / `CANCELLED` | `rejectWithdrawal` returns the lock |
| Webhook `payout.failed` | `failPayout` releases the lock, status `FAILED` |
| Webhook `payout.reversed` | `reversePayout` |

### Online payout

`PATCH /api/admin/withdrawal/payout` `{ withdrawalId }`.

Only `PENDING` withdrawals. Requires `razorpayContactId` and `razorpayFundAccountId` already on the withdrawal (so this path is the `ONLINE` path).

Razorpay body: amount in paise (`withdrawalAmount * 100`), mode `UPI` or `NEFT`, `queue_if_low_balance: true`, `reference_id` = withdrawal id, `account_number` = `RAZORPAY_ACCOUNT_NUMBER`.

On HTTP success the withdrawal becomes `PROCESSING` and stores `razorpayPayoutId`. Wallet pending is not changed here.

### Webhook

`POST /api/web-hook/razorpay/withdrawal-payout`

Raw JSON body is captured **before** `express.json()` in `index.js`. Signature: `validateWebhookSignature(rawBody, x-razorpay-signature, RAZORPAY_WEBHOOK_SECRET)`.

Events handled: `payout.processed`, `payout.failed`, `payout.reversed`.

If `RAZORPAY_WEBHOOK_SECRET` is missing, signature verification fails. The handler calls `validateWebhookSignature` and does not itself return 400 when the signature is bad; a thrown error from the Razorpay helper becomes a 500 via `next` only if it throws. Confirm the installed `razorpay` helper’s behaviour when the signature does not match.

### History

`GET /api/admin/withdrawal/all` for admins.

Affiliate history is the wallet `transactions` array plus `AffiliateHistory` rows written with actions `WITHDRAWAL-REQUEST`, `WITHDRAWAL-ACCEPT`, `WITHDRAWAL-REJECT`, `WITHDRAWAL-COMPLETED`, `WITHDRAWAL-CANCELLED`.

Portal: `src/app/wallet/page.tsx`, withdraw steps under `src/components/pages/wallet/withdraw/`. PIN create: `src/app/api/user/set-withdrawal-pin/route.ts` and `src/app/api/user/update-withdrawal/route.ts` (portal Mongo, not the affiliate server).

---

## 19. Database Schema

Mongoose default collection names are the pluralized model names. Confirm with `db.getCollectionNames()` if a name looks off. Database name is whatever is in `MONGODB_URL`.

### `User` — collection `users`

Model file: `models/aff-user.js` (server) and `src/models/User.ts` (portal).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userName`, `fullName`, `email`, `mobile` | String | no | Login is by `mobile` |
| `password` | String | no in schema | bcrypt hash |
| `userType` | enum `USER`, `ADMIN`, `SUPER_ADMIN` | yes, default `USER` | |
| `status` | status enum | default `PENDING` | |
| `referralId` | String | unique | `AFF{yy}{5 digits}` |
| `referralCount` | Number | default 0 | Incremented when someone registers with this id |
| `domain` | ObjectId → `domain` | | Admin’s domain doc |
| `platformId` | ObjectId → `Platform` | | Set for admins at register |
| `workingOn` | ObjectId → `User` | | Affiliate’s active admin |
| `collaborateWith[]` | `{ accountId, status: ACCEPTED\|REJECTED\|PENDING }` | | |
| `campaignAccessKey` | `[String]` | | |
| `campaignId` | `[ObjectId → Campaign]` | | |
| `affType.type` | `INDIVIDUAL\|SPECIAL\|COMPANY` | default `INDIVIDUAL` | |
| `affType.commission` | Number | | Percent override |
| `affType.commissionType` | `ALL_PRODUCT\|ONLY_AFF_PRODUCT` | default `ONLY_AFF_PRODUCT` | |
| `affType.tdsType` | `LINKED\|UN_LINKED` | default `LINKED` | |
| `affType.isTdsEnabled` | Boolean | default true | |
| `registrationVerified` | Boolean | default false | OTP done |
| `emailVerified`, `campaignStarted`, `policyVerified`, `isBlocked` | Boolean | | `campaignStarted` gates portal routes |
| `commissionDetails.*` | Numbers | | Updated at commission create, not by the payout cron |
| `actions.totalClicks/totalOrders/totalSales` | Numbers | | `totalSales` is not incremented by the purchase handler |
| `payouts.*` | Numbers | | Not updated by the commission cron |
| `transactionDetails` | withdrawal method, UPI, bank | | Drives Razorpay fund accounts |
| `razorpayAccounts.upi/bank` | contactId, fundAccountId, isUpdated | | |
| `withdrawalDetails` | bank, `withdrawalPin` (bcrypt), `havePin`, `haveBank` | | |
| `otp`, `otpExpiry`, `forgotPin` | | | OTP stored in plaintext |
| `documents[]`, `address[]`, `social`, `notifications`, `avatar`, `gender` | | | |
| timestamps | | | |

Referral id index: unique.

### `Campaign` — `campaigns`

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId User | required |
| `company.domain` | String | |
| `company.accountId` | ObjectId User | required, the admin |
| `campaignLink` | String | |
| `campaignAccessKey` | String | |
| `returnPeriod` | Number | default 1 |
| `clicks`, `ordersCount` | Number | |
| `commissionDetails` | totals | |
| `commissionRecords` | `[ObjectId → Commissions]` | |
| `product.productId` | ObjectId ref `Product` in schema, but the create handler stores the **store id string** | The schema ref does not match how ids are saved |
| `product.title/image/mrp/category/categoryId` | | Snapshots |
| `status` | `ACTIVE\|INACTIVE\|PAUSED\|ENDED\|HOLD` | default `ACTIVE` |

### `Product` — `products`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `domain` | String | yes | Normalized store URL |
| `productId` | String | yes | Store product id |
| `productName` | String | yes | |
| `mrp` | Number | yes | |
| `category` | String | | |
| `variations[]` | photos, sizes | | |
| `commission` | Number | default 0 | Percent |
| `isActive` | Boolean | default true | |
| `status` | `ACTIVE\|PAUSED` | default `ACTIVE` | |

Unique index `{ productId: 1, domain: 1 }`.

### `Commissions` — `commissions`

Unique index `{ orderId: 1 }`. Fields listed in section 16. `createdAt` is set in the schema path, and the collection also has no `{ timestamps: true }` option, so there is no `updatedAt` unless something else sets it.

### `Wallet` — `wallets`

Unique `{ userId, adminId }`. Fields in section 17.

### `Withdrawals` — `withdrawals`

| Field | Notes |
| --- | --- |
| `user`, `adminId` | ObjectIds, required |
| `paymentMethod` | `BANK` or `ONLINE` |
| `onlineMethod` | `{ method: BANK\|UPI, upiId, bank }` |
| `withdrawalAmount` | Net after transfer charge |
| `requestedAmount` | Amount the user asked to withdraw |
| `transferCharge`, `cancelledAmount`, `tdsAmount` | `tdsAmount` required, default 0, set to 0 on create |
| `razorpayContactId`, `razorpayFundAccountId`, `razorpayPayoutId` | |
| `balanceBefore`, `balanceAfter` | |
| `status` | `PENDING\|PROCESSING\|COMPLETED\|CANCELLED\|FAILED\|REJECTED\|REVERSED` |
| `rejectReason` | |
| `accountingApplied` | Boolean, prevents double settlement |
| `accountingKind` | `COMPLETE\|RELEASE\|REVERSE_AFTER_COMPLETE` |

### `Platform` — `platforms`

| Field | Notes |
| --- | --- |
| `domain` | Store URL |
| `adminId` | User, required |
| `accessKey` | ObjectId → `NpmPackage` |
| `adminType` | user type enum, default `USER` (schema default is misleading for real rows) |
| `commission` | Default percent |
| `returnPeriod` | Default 0. Campaign stores its own copy from the body |
| `backendRoutes.products` | Absolute URL of the store catalog |
| `paymentMethods` | `MONTHLY\|LIMITED\|ENTER`, `minAmount`, `maxAmount`, `amount[]` |
| `bankTransfer`, `onlineTransfer` | `enabled`, `FIXED\|PERCENT`, `transferCharge` |
| `tdsLinkedMethods`, `tdsUnLinkedMethods` | `FIXED\|PERCENT`, `amount` |
| `termAndConditions.rules[]`, `policy` | |

### `NpmPackage` — `npmpackages`

| Field | Notes |
| --- | --- |
| `platformName` | required |
| `domain` | required, unique |
| `apiKey` | required, unique, `PLAT-` + 32 hex chars |
| `active` | default true. `POST /api/npm/register` deactivates all others. `validatePlatformApiKey` does **not** check `active` |

### `domain` — model name `domain`

`registeredUserId`, `name` (unique), `url` (unique), `logo`.

### `DailyAction` — `dailyactions`

Unique `{ userId, adminId, date }`. Counters: `clicks`, `orders`, `sales`, `earnings`, `activeCampaigns`, `paidCommission`. `date` is `YYYY-MM-DD`.

### `Tier` — `tiers`

`adminId`, `platformId`, `tierName`, `description`, `order`, `isStartingTier`, `isActive`, `levels[]`.

Level: `levelNumber`, `spinCount`, `timePeriod`, `rewardMethod` `SPIN|SCRATCHCARD`, `goals[]` (`ORDERS|CLICKS|SALES` + `target`), `rewards[]` (`rewardType`, `label`, `value`, `valueType`, colors, image).

### `UserTierProgress` — `usertierprogresses`

`userId`, `adminId`, `platformId`, `currentTierId`, `currentLevel`, `isTierCompleted`, `goalProgress[]`, `progressHistory[]`.

### `TierRewardLog` — `tierrewardlogs`

`adminId`, `platformId`, `userId`, `tierId`, `levelNumber`, `spinCount`, `rewardMethod`, `rewards[]`, `collectedRewards[]`, `status`, `isClaimed`, `isCollected`, `isDelivered`, `action`.

Collected reward status: `PENDING|PROCESSING|PAID|CANCELLED`.

### Other collections

| Model | File | Role |
| --- | --- | --- |
| `Transaction` | `models/transactionSchema.js` | Separate ledger (`walletId`, `PAY\|COMMISSION\|WITHDRAWAL\|REFUND\|RECHARGE`). Commission list reads it. Purchase flow does not write it |
| `Referring` | `models/referringPeopleSchema.js` | Parent/child referral, `level` default 1. No multi-level commission math was found |
| `Settings` | `models/settingsSchema.js` | Admin theme and placed images/videos |
| `Notifications` | `models/notificationSchema.js` | In-app messages |
| `Feedbacks` | `models/feedbackSchema.js` | `BUG-REPORT`, `SUGGESTIONS`, `GENERAL` |
| `Ticket` | `models/ticketScheduleSchema.js` | Schedule-a-call |
| `AffiliateHistory` | `models/AffiliateHistorySchema.js` | Audit of PIN, withdrawal, password, and similar actions |
| `Order` | `models/uracca-order.js` | Store-shaped order schema. Not used by attribution |

---

## 20. API Reference

Base URL locally: `http://localhost:{PORT}/api` with `PORT` default `8000`.

SDK production default: `https://affiliate.server.uracca.com/api`.

Auth legend: **User** = `aff_ses_server` or Bearer, account `APPROVED`. **Admin** = `aff-admin-tkn`. **Key** = `x-api-key` + `x-domain`. **None** = no middleware on that route.

Error JSON from `errorHandler`:

```json
{ "success": false, "error": "NotFoundError", "message": "...", "stack": "only when NODE_ENV=development" }
```

Duplicate key → 409. ValidationError → 400. Many handlers return their own `{ success, message }` instead of using `next(error)`.

### Authentication

| Method | Path | Auth | Body | Handler |
| --- | --- | --- | --- | --- |
| POST | `/api/user/user-login` | None | `{ mobile, password }` | `loginUser` |
| POST | `/api/user/admin-login` | None | `{ mobile, password, domain }` | `loginAdmin` |
| POST | `/api/user/user-register` | None | multipart fields + `documents` (max 5) | `registerUser` |
| POST | `/api/user/admin-register` | Super admin, or open if none exists | `{ mobile, password, email, domain, type }` | `registerAdmin` |
| GET | `/api/user/current-admin` | Admin | | `getCurrentUsers` |
| POST | `/api/user/logout-admin` | Admin | | `logoutAdmin` |

User login 200: `{ success: true, message, token }` plus `Set-Cookie`.

### Affiliate user

| Method | Path | Auth | Purpose | Handler |
| --- | --- | --- | --- | --- |
| GET | `/api/user/all` | Admin | Affiliates for this admin | `getAllAffUsersForEachAdmins` |
| GET | `/api/user/all-admins` | User | Admins the affiliate can see | `getAllAdminsAffUsers` |
| PUT | `/api/user/update-status/:userId` | Admin | Approve / reject / block and set `affType` | `updateAffUserStatus` |
| PUT | `/api/user/generic-update/:userId` | Admin | `$set` body | `genericUpdateAffUser` |
| PUT | `/api/user/generic-update-user/:userId` | User | `$set` body | `genericUpdateAffUser` |

### Campaign

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| PUT | `/api/users/campaign/create` | User | `createCampaign` |
| GET | `/api/users/campaign` | User | `getUserCampaigns` |
| PATCH | `/api/users/campaign/:campaignId` | Admin | `genericUpdateCampaigns` |
| GET | `/api/users/campaign/admin/activeCampaigns/:userId` | Admin | `getUserCampaigns` |

Create 201 `data`: `{ campaignId, campaignAccessKey, campaignLink }`.

### Product

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/admin/products` and `/api/users/products` | None | `getProductsFromDb` |
| POST | same `/` | None | `updateProductsToDb` |
| PATCH | `/:id` | None | `updateProductCommission` |
| GET | `/api/users/products/newCampaign/:adminId` | User | `getProductsForUsersFromDb` |

### Click, purchase, cancel

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/affiliate/clicks` | Key | `trackAffiliateClick` |
| POST | `/api/affiliate/purchase-campaign` | Key + `checkUserStatus` | `purchaseOrderWithAffiliateCampaign` |
| PATCH | `/api/affiliate/cancel-amount/:orderId` | Key | `cancelWalletCommissionAmountFromAff` |

Purchase 200 example:

```json
{
  "message": "Commission recorded successfully",
  "data": {
    "totalValidAmount": 1000,
    "commissionAmount": 100,
    "tdsAmount": 10,
    "finalCommission": 90,
    "commissionPercent": 10,
    "eligibleCount": 1,
    "validProducts": [{ "productId": "665f0c0c0c0c0c0c0c0c0c0c", "productAmount": 1000 }],
    "blockedProducts": []
  }
}
```

### Commission

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/users/commission/all` | User | `userAllCommissionDetails` |
| GET | `/api/users/commission/summary` | User | `userCommissionSummary` |

### Wallet

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| GET | `/api/wallet/` | Admin | `getAllWallets` |
| GET | `/api/wallet/:adminId` | Admin | `getAdminWallets` |
| GET | `/api/wallet/:userId/:adminId` | User | `getUserAdminWallet` |
| PATCH | `/api/wallet/recharge/:userId/:adminId` | User | `rechargeUserWallet` |

Route order in `routes/wallet-route.js` registers `GET /:adminId` before `GET /:userId/:adminId`. A two-segment path still matches the second route. A one-segment path matches the admin route.

### Payout

| Method | Path | Auth | Handler |
| --- | --- | --- | --- |
| POST | `/api/user/withdrawal/new-withdrawal/:adminId` | User + status check | `processWithdrawal` |
| GET | `/api/admin/withdrawal/all` | Admin | `getAllAffWithdrawalHistory` |
| PATCH | `/api/admin/withdrawal/action` | Admin + status check | `updateAffWithdrawalStatus` |
| PATCH | `/api/admin/withdrawal/payout` | Admin | `payWithdrawalToUser` |
| POST | `/api/web-hook/razorpay/withdrawal-payout` | Razorpay signature | `razorpayWebhook` |

Withdrawal POST is rate-limited to 1 request per minute (`rateLimitConfig.js`). `/api/user` itself is `noLimit: true`, and limiters are registered from longest path first, so the withdrawal limiter is the one that should apply.

### Platform, tier, misc

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/admin/platform/` | Admin |
| PUT | `/api/admin/platform/update` | Admin |
| GET | `/api/admin/platform/platformToUser/:adminId` | User |
| POST | `/api/admin/platform/general/settings` | Admin |
| GET | `/api/admin/platform/general/settings` | None |
| POST | `/api/npm/register` | None |
| POST | `/api/tier/` | Admin |
| GET | `/api/tier/user/my-tier` | User |
| PUT | `/api/tier/user/claim/reward` | User |
| PATCH | `/api/tier/admin/reward/update/:rewardLogId` | Admin |
| GET | `/api/users/bulk-details/user-chart-data` | User |
| GET | `/api/admin/bulk-details/` | Admin |
| POST | `/api/admin/ticket/call` | None |
| GET | `/` | None, body `success` |

Portal routes that hit Mongo directly (origin is the Next app, not the affiliate server):

| Method | Path | Role |
| --- | --- | --- |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/send-otp` | OTP |
| POST | `/api/auth/verify-otp` | Verify OTP |
| POST | `/api/auth/login` | Alternate login; not used by `LoginPage` |
| POST | `/api/auth/logout` | Clear cookies |
| POST | `/api/admin/collaborate` | Collaboration request |
| POST | `/api/admin/collaborate/workingOn` | Set `workingOn` |
| POST | `/api/user/set-withdrawal-pin` | PIN |
| POST | `/api/user/update/password` | Password |
| POST | `/api/dev/tier-click` | Development only |

---

## 21. Frontend Architecture

### Pages

| Route | Role | Main UI | Backend |
| --- | --- | --- | --- |
| `/` | Marketing home | `src/components/home/static-home-page.tsx` | None until login |
| `/login` | Login | `src/components/auth/login/login-page.tsx` | `POST /api/user/user-login` then NextAuth |
| `/register` | Register | `register-page.tsx` | Portal `POST /api/auth/register` |
| `/forgot-password` | Password recovery page | | |
| `/forgot-pin` | Withdrawal PIN recovery | | Portal OTP + forgotPin token |
| `/dashboard` | Home after login. If `campaignStarted` is false this is the only protected page the middleware allows | `src/app/dashboard/page.tsx` | Session from Mongo; charts via `GET /api/users/bulk-details/user-chart-data` |
| `/campaigns` | Campaign list | `src/components/campaigns-sec/` | `GET /api/users/campaign` |
| `/products/[slug]` | Product detail and start campaign | `start-campain-button.tsx` | `GET .../newCampaign/:adminId`, `PUT .../campaign/create` |
| `/earnings` | Commission list | `src/components/earnings/earning-page.tsx` | `GET /api/users/commission/all` and `/summary` |
| `/earnings/[commissionId]` | One commission | | Same list, filtered |
| `/wallet` | Balance and withdraw | `src/components/pages/wallet/wallet-page.tsx` | Session wallet + `POST /api/user/withdrawal/new-withdrawal/:adminId` |
| `/tier` | Tier progress | `tier-page-user.tsx` | `GET /api/tier/user/my-tier` |
| `/tier/rewards` | Rewards | | `GET /api/tier/user/allMyRewards` |
| `/tier/rewards/[rewardId]` | Claim UI | | `PUT /api/tier/user/claim/reward` |
| `/settings` | Account, collaborate, security, feedback, help, delete, logout | `settings-options.tsx` | Mix of NextAuth update and `PUT /api/user/generic-update-user/:userId` |
| `/settings/account` | Profile | | |
| `/settings/collaborate` | Pick admin / workingOn | | Portal `/api/admin/collaborate/workingOn` |
| `/settings/security` | Password / PIN | | Portal user routes |
| `/settings/feedback` | Feedback | | Portal `src/app/api/user/feedbacks/route.ts` |
| `/settings/contact` | Schedule call | | `POST /api/admin/ticket/call` |
| `/settings/help` | Static help copy | | |

Mobile tabs: Dashboard, Wallet, Earnings, Campaigns.

### State

| Layer | What it holds |
| --- | --- |
| NextAuth session | Full user, wallet, daily actions. This is what pages treat as the current user |
| Redux `user` | Login flag / user slice (`userReducer.ts`) |
| Redux `action` | UI flags such as withdraw step (`actionReducer.ts`) |
| Redux `settings` | Platform settings for the active admin (`AffSettingsSlice.ts` → `GET /api/admin/platform/platformToUser/:adminId`) |
| TanStack Query | Campaigns, products, commissions, mutations |

Encrypted campaign and commission payloads are decrypted in the client/server actions with `decryptData`.

### Auth state and cookies

| Cookie | Set by | Used by |
| --- | --- | --- |
| `aff_ses_tkn` | NextAuth | Page middleware |
| `aff_ses_server` | Affiliate server login | `authenticateUser` |

Both must succeed for a normal session. API helpers pass `withCredentials: true`.

### Page → API → database (campaign example)

```
/products/[slug]
  → StartCampaignButton
  → createCampaignAction
  → create_campaign_api
  → PUT {BACKEND_URL}/api/users/campaign/create
  → authenticateUser
  → createCampaign
  → campaigns + users.campaignAccessKey
```

---

## 22. Backend Architecture

```
index.js
  loadEnv (required keys, exit if missing)
  CORS allow-list + tenant admin regex
  rate limiters from rateLimitConfig
  routers
  errorHandler
  listen
  connectDB → repairAffiliateProductDomains
  cron imported for side effect
```

There is no service layer for orders or commissions. The purchase function in the controller talks to Mongoose directly. Tier progress is the exception: `services/tier/tierProgressEngine.js`.

### Middleware

| File | Role |
| --- | --- |
| `middleware/middleware.js` | `authenticateUser`, `authenticateAdmin`, `requireSuperAdminUnlessBootstrap` |
| `middleware/checkUserStatus.js` | Blocked / suspended / paused |
| `middleware/validatePlatformApiKey.js` | Store SDK |
| `middleware/errorMiddleware.js` | JSON errors |
| `middleware/upload.middleware.js` | Multer memory, field `documents`, max 5 |
| `middleware/rateLimiter.js` | From `rateLimitConfig.js` |

### Validation

Mostly inline `if (!field)` checks. `utils/validators/validateBody.js` and `validateTierLevels.js` exist for tiers. There is no shared schema validator (no zod/joi on the server).

### Error handling

Throw `NotFoundError`, `MissingFieldError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError`, `InvalidError`, `AlreadyExistsError` from `utils/errors.js`. `InvalidError` sets `name` to `"UnauthorizedError"` and status 401.

Plain `throw new Error("...")` becomes HTTP 500.

---

## 23. Order → Commission Integration

There is no order service in this repository. The integration point is a single HTTP call from the store.

| | |
| --- | --- |
| SDK | `haash-affiliate/src/orders/orders.js` `OrderCampaign` |
| HTTP | `POST {baseURL}/affiliate/purchase-campaign` |
| Route | `routes/affiliate-route.js` |
| Middleware | `validatePlatformApiKey`, `checkUserStatus` |
| Function | `purchaseOrderWithAffiliateCampaign` |
| File | `controllers/campaign/track-aff-container.js` |
| Parameters | `referralId`, `campaignAccessKey`, `productDetails[]`, `orderId` |
| Writes | `commissions` insert; `campaigns` totals, `ordersCount`, `commissionRecords`; `users` totals and `actions.totalOrders`; `dailyactions.orders`; tier `ORDERS` |
| Does not write | Store `orders`, payments, invoices |

Second integration point for later changes:

| | |
| --- | --- |
| SDK | `CancelCommission(orderId, productId)` |
| HTTP | `PATCH /api/affiliate/cancel-amount/:orderId` |
| Function | `cancelWalletCommissionAmountFromAff` |
| File | `controllers/wallet/wallet-controller.js` |

Click integration:

| | |
| --- | --- |
| SDK | `TrackClick` |
| Function | `trackAffiliateClick` |
| Same file as purchase | `controllers/campaign/track-aff-container.js` |

### Why a commission failure must not be treated as an order failure

The affiliate server does not create the customer order. By the time `OrderCampaign` runs, the store has already created it (that is the contract of the SDK: the store passes an existing `orderId`). If this endpoint returns 4xx/5xx, the commission is missing and the order can still exist. The handler does not call back into the store.

Idempotency is the safety net for retries: the same `orderId` returns 200 and does not double-count.

Call sites inside the store were not in this workspace, so the exact file in the commerce server is unknown. Search that repo for `OrderCampaign`, `TrackClick`, `purchase-campaign`, and `@haash/affiliate`.

---

## 24. Multi-Domain / Platform Architecture

### Recognised hosts (CORS in `index.js`)

Hard-coded:

- `https://www.uracca.com`, `https://uracca.com`
- `https://www.uracca.in`, `https://uracca.in`
- `https://www.admin.uracca.com`, `https://admin.uracca.com`
- `https://www.admin.uracca.in`, `https://admin.uracca.in`
- `https://affiliate.uracca.com`
- `https://example.uracca.com`, `https://www.example.uracca.com`
- `https://example.uracca.in`, `https://www.example.uracca.in`
- `https://example.admin.uracca.com`, `https://example.admin.uracca.in`

Plus `ALLOWED_ORIGINS` (comma-separated).

Plus any `https` host matching `^(?:www\.)?(?:[a-z0-9-]+\.)?admin\.uracca\.(com|in)$`.

`www` vs non-`www` is allowed when the other form is in the list. Requests with no `Origin` are allowed (server-to-server, curl).

Localhost is **not** in the CORS list unless added through `ALLOWED_ORIGINS`. Browser calls from `http://localhost:3000` to the affiliate server fail CORS until that origin is configured.

### How a platform is identified

1. Admin registers with a store URL → `domain` document + `Platform.domain`.
2. Saving platform settings creates `NpmPackage` `{ domain, apiKey }` if `accessKey` is empty.
3. The store calls `InitAffiliate({ domain, apiKey })`.
4. `x-domain` must match `NpmPackage.domain` (host compare, `www` ignored), except localhost.

`storeHostsConflict` treats `uracca.com` and `shop.uracca.com` as a conflict, and does **not** treat `uracca.com` and `example.uracca.in` as a conflict (different host+TLD). Admin registration uses this to reject overlapping domains.

### Campaign domain vs product domain

- Campaign domain is the string the portal sent (`NEXT_PUBLIC_STORE_URL`).
- Product domain is `Product.domain`.
- Purchase compares `normalizeStoreUrl(localProduct.domain)` with `normalizeStoreUrl(platform.domain)`.

Mismatch → that line is in `blockedProducts` with reason `Product domain mismatch`. If every line is blocked, the API throws `No valid active products found for this order`.

`normalizeStoreUrl` does not treat `www` and bare host as equal, and it does not treat `.com` and `.in` as equal.

On Mongo connect, `repairAffiliateProductDomains` rewrites platform and domain URLs to the normalized form and moves product rows whose domain is not a live platform onto the super-admin platform domain. That runs at every server start (`config/db.js`).

### Adding a platform

1. Register an admin with the new store URL (`POST /api/user/admin-register`) or have a super admin do it. The URL must not conflict under `storeHostsConflict`.
2. Set `Platform.backendRoutes.products` to the public catalog URL.
3. Set commission, TDS, transfer fees, `paymentMethods`, `returnPeriod`.
4. Save platform settings so an `NpmPackage` api key is created (`PUT /api/admin/platform/update`).
5. Put that api key and domain into the store’s `InitAffiliate`.
6. Add the store origin and the admin origin to CORS (`ALLOWED_ORIGINS` or the hard-coded list if it is not already covered).
7. Sync products (`POST /api/admin/products`) with `domain` equal to the normalized platform URL.
8. Point the affiliate portal `NEXT_PUBLIC_STORE_URL` at that store **including the trailing slash**, or campaign links will be wrong. One portal env value cannot represent every tenant; tenant links depend on the value sent in the create-campaign body.

---

## 25. Environment Variables

Values are never listed. Format is the shape the code expects.

### Affiliate server (`utils/loadEnv.js`)

Required or the process exits:

| Name | Required | Purpose | Where |
| --- | --- | --- | --- |
| `MONGODB_URL` | yes | Mongo connection string | `config/db.js` |
| `PORT` | yes (checked) | Listen port. Code also falls back to `8000` if unset, but loadEnv exits first | `index.js` |
| `NODE_ENV` | yes | `development` adds error stacks. Also affects cookie `secure` and log lines | error handler, login cookies |
| `JWT_SECRET_USER` | yes | Affiliate JWT | `middleware/middleware.js`, `loginUser` |
| `JWT_SECRET_ADMIN` | yes | Admin JWT | `loginAdmin`, `authenticateAdmin` |
| `SESSION_SECRET` | yes | `express-session` secret. A separate `cookie-session` uses hard-coded keys `key1` and `key2` | `index.js` |
| `DATA_SECRET_KEY` | yes | 64 hex characters (32 bytes) for AES-256-CBC | `utils/cript-data.js` |
| `RAZORPAY_KEY_ID` | yes | Razorpay key. Listed twice in the required array | payouts, contact/fund |
| `RAZORPAY_KEY_SECRET` | yes | Razorpay secret | same |
| `RAZORPAY_ACCOUNT_NUMBER` | yes | RazorpayX account number on payouts | `withdrawal-payout-controller.js` |
| `ENTITY_ID` | yes | Present in the required list. No read of `process.env.ENTITY_ID` was found outside `loadEnv.js` | |
| `SENDER_ID` | yes | Fast2SMS sender id | `lib/otp-sender/index.js` |

Optional on the server:

| Name | Purpose |
| --- | --- |
| `FAST2SMS_API_KEY` | SMS OTP |
| `BREVO_API_KEY` | Listed optional. No usage site was found in the server search |
| `cloudinary_cloud_name`, `cloudinary_api_key`, `cloudinary_api_secret` | Listed optional. No Cloudinary client usage was found on the server |
| `ALLOWED_ORIGINS` | Extra CORS origins, comma-separated |
| `COOKIE_DOMAIN` | Fallback only if Origin parsing throws |
| `STORE_PRODUCTS_URL` | Forces every catalog fetch to this URL, ignoring `backendRoutes.products` |
| `MEDIA_SERVER_URL`, `MEDIA_SERVER_UPLOAD_ORIGIN`, `MEDIA_SERVER_API_KEY` | Registration document upload |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_MAIL`, `SMTP_PASSWORD` | Email OTP. Not in the required list; email send fails if missing |
| `RAZORPAY_WEBHOOK_SECRET` | Payout webhook. Not in the required list |

`loginAdmin` / `loginUser` contain `\|\| "supersecretkey"` fallbacks. They do not run if loadEnv already exited for a missing secret. Do not remove the env keys and rely on the fallback.

### Affiliate portal

From `next.config.ts` `env` and code reads:

| Name | Purpose |
| --- | --- |
| `MONGODB_URL` | Portal Mongo (`src/lib/db/mongodb.ts`). `next.config.ts` also copies `MONGODB_URI`, which the db file does not read |
| `BACKEND_URL` | Axios base URL for the affiliate server |
| `IP_ADDRESS` | Fallback base URL if `BACKEND_URL` is empty |
| `AUTH_URL` | Base for portal auth fetches (`send-otp` and similar) |
| `BASE_USER_URL` | Used by some actions (withdrawal client fetch) |
| `COOKIE_DOMAIN` | Logout / cookie helper |
| `NEXT_PUBLIC_STORE_URL` | Prefix for new campaign links. Must end with `/` |
| `NEXT_PUBLIC_DATA_SECRET_KEY` | Same 64 hex chars as server `DATA_SECRET_KEY`. It is `NEXT_PUBLIC_`, so it is embedded in the client bundle |
| `AFF_INIT_SECRET_KEY`, `AFF_INIT_SECRET_DOMAIN` | Exposed via `next.config.ts` `env`. No call site besides that file was found |
| `MEDIA_SERVER_URL`, `MEDIA_SERVER_UPLOAD_ORIGIN`, `MEDIA_SERVER_API_KEY` | Uploads |
| `SENDER_ID`, `FAST2SMS_API_KEY`, `SMTP_*` | OTP, same names as the server |
| `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `src/lib/cloudinary.ts` |
| `JWT_SECRET` | Only the unused-by-login-page route `src/app/api/auth/login/route.ts` |
| `AUTH_SECRET` | NextAuth’s own signing secret (NextAuth convention; set it even though this repo’s `auth.ts` does not read the name directly) |

### Local vs production

The code branches on `NODE_ENV` and on whether the request Origin is localhost or `https://`. There is no `STAGING` flag.

| | Local | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` (error stacks, dev recharge button, dev tier-click route) | `production` (secure cookies, no stacks) |
| Cookie domain | unset when Origin contains `localhost` | `.{sld}.{tld}` from Origin |
| Razorpay | `lib/razorpayValidation.js` checks `RAZORPAY_KEY_ID.startsWith("rzp_test")` | live key id |
| SDK `baseURL` | pass `baseURL: "http://localhost:8000/api"` into `InitAffiliate` | default `https://affiliate.server.uracca.com/api` |

---

## 26. Local Development Setup

Node is not pinned (`engines` is absent). Use a current Node that supports Express 5 and Next 15.

1. Clone both repositories.

```bash
git clone https://github.com/haashtech/affiliate.server.git
git clone https://github.com/haashtech/affiliate.uracca.com.git
```

2. Install.

```bash
cd affiliate.server && npm install
cd affiliate.uracca.com && npm install
```

3. Create `affiliate.server/.env`. `utils/loadEnv.js` exits if the file or any required key is missing. Use a non-production Mongo database.

```
MONGODB_URL=<REDACTED>
PORT=8000
NODE_ENV=development
JWT_SECRET_USER=<REDACTED>
JWT_SECRET_ADMIN=<REDACTED>
SESSION_SECRET=<REDACTED>
DATA_SECRET_KEY=<64 hex characters>
RAZORPAY_KEY_ID=<REDACTED>
RAZORPAY_KEY_SECRET=<REDACTED>
RAZORPAY_ACCOUNT_NUMBER=<REDACTED>
ENTITY_ID=<REDACTED>
SENDER_ID=<REDACTED>
ALLOWED_ORIGINS=http://localhost:3000
```

4. Create the portal `.env` / `.env.local` with at least:

```
MONGODB_URL=<same database as the server>
BACKEND_URL=http://localhost:8000
AUTH_URL=http://localhost:3000/api/auth
NEXT_PUBLIC_STORE_URL=http://localhost:3002/
NEXT_PUBLIC_DATA_SECRET_KEY=<same 64 hex chars as DATA_SECRET_KEY>
AUTH_SECRET=<REDACTED>
```

`NEXT_PUBLIC_STORE_URL` must include the trailing slash. `http://localhost:3002/` is the fallback already hard-coded in the campaign button; the store itself is a separate app.

5. Start the affiliate server.

```bash
cd affiliate.server
npm start
```

That script is `nodemon index.js`. A successful boot prints that the server is on `PORT` and that Mongo connected. It then runs `repairAffiliateProductDomains`.

6. Start the portal.

```bash
cd affiliate.uracca.com
npm run dev
```

Open `http://localhost:3000`.

7. Sanity-check the API.

```bash
curl http://localhost:8000/
```

Expect the text `success`.

8. Register an affiliate from `/register`, complete OTP, then approve the user in Mongo or through the admin API:

```bash
curl -X PUT http://localhost:8000/api/user/update-status/<userId> \
  -H "Content-Type: application/json" \
  -H "Cookie: aff-admin-tkn=<admin token>" \
  -d '{"status":"APPROVED","type":"INDIVIDUAL","commissionType":"ONLY_AFF_PRODUCT","isTdsEnabled":true}'
```

9. The affiliate must set `workingOn` to an admin id (portal Collaborate settings) before a campaign can be created.

10. Create a campaign from the product page, or `PUT /api/users/campaign/create` with the affiliate cookie.

11. Click test (needs an `NpmPackage` api key):

```bash
curl -X POST http://localhost:8000/api/affiliate/clicks \
  -H "Content-Type: application/json" \
  -H "x-api-key: PLAT-<key>" \
  -H "x-domain: http://localhost:3002" \
  -d '{"referralId":"AFF2600001","campaignAccessKey":"AFF_000000ABCDEF_CAMP"}'
```

Localhost in `x-domain` skips the host match.

12. Purchase test uses the same headers and `POST /api/affiliate/purchase-campaign`.

13. Confirm a `commissions` document with that `orderId` and `status: "PENDING"`. Wallet balance does not move until the cron’s day rule passes. For a local test, temporarily set that campaign’s `returnPeriod` and the commission `createdAt` so `diffDays >= returnPeriod + 1`, or wait. Do not point this cron at a production database.

The store and the admin UI are separate projects. This setup does not boot them.

---

## 27. Production Deployment

Nothing in either repository defines the VPS, PM2 process names, nginx, or CloudPanel sites. The following is what the code itself requires. Confirm the live process manager on the server before changing it.

### Domains the code expects

| Surface | Host |
| --- | --- |
| Affiliate portal | `https://affiliate.uracca.com` |
| Affiliate API | `https://affiliate.server.uracca.com` (SDK default; path prefix `/api`) |
| Store | `uracca.com`, `uracca.in`, and tenant hosts allowed by CORS |
| Admin | `admin.uracca.com`, `admin.uracca.in`, `{tenant}.admin.uracca.com` |

### Commands that exist

Affiliate server:

```bash
npm install
npm start          # nodemon index.js — this is the only start script
```

There is no `node index.js` production script. `nodemon` is a dependency, not a devDependency. If production uses PM2, the process file is outside this repo. A reasonable process is `node index.js` after `NODE_ENV=production` and the production `.env` are in place. Do not invent a PM2 name.

Affiliate portal:

```bash
npm install
npm run build      # next build
npm start          # next start
```

`npm run dev` is not a production start.

### Order

1. Confirm `MONGODB_URL` for both apps is the same production database, and that `DATA_SECRET_KEY` matches `NEXT_PUBLIC_DATA_SECRET_KEY`.
2. Deploy the affiliate server first. `GET /` should return `success`.
3. Deploy the portal with `BACKEND_URL` pointing at the public API origin (no trailing path issues: axios calls already include `/api/...`).
4. Restart so the new build is what `next start` serves. An old `.next` build is the usual reason “production still shows old UI”.
5. Store deploy is separate and must use the matching `NpmPackage` api key, domain, and SDK `baseURL`.

### Logs

The server uses `morgan("dev")` twice and `console.log` / `console.error`. Cron logs `Running commission payout job` every minute. There is no application log file path in the repo. If PM2 is used on the host, `pm2 logs` is the place to look; that was not verified from code.

### Rollback

Redeploy the previous git commit and restart the process. There are no migration scripts in the repo. `repairAffiliateProductDomains` runs on every boot and can rewrite `Product.domain` and `Platform.domain`. Read that function before rolling a database backward.

### Safe deploy checks

- Do not run a second cron against the same database (two servers both run `commissionPayoutJob`). The job is idempotent per commission via `findOneAndUpdate`, but two processes still race on wallet increments if both pass the claim. Run one instance.
- Webhook URL to give Razorpay: `https://affiliate.server.uracca.com/api/web-hook/razorpay/withdrawal-payout`.
- CORS: a new admin or store origin must be listed or it is rejected with `Not allowed by CORS`.

---

## 28. Git Workflow

| Repo | Remote | Default branch | Other branch |
| --- | --- | --- | --- |
| affiliate.server | `origin` `https://github.com/haashtech/affiliate.server.git` | `main` | `wallet` |
| affiliate.uracca.com | `origin` `https://github.com/haashtech/affiliate.uracca.com.git` | `main` | `wallet` |

`main` is the branch that was checked out during this inspection. The repositories do not document a separate production branch. Treat `main` as production only if the host deploys `main`. Confirm on the server with `git rev-parse --abbrev-ref HEAD` and `git log -1`.

Useful commands:

```bash
git status
git log --oneline -20
git fetch origin
git pull origin main
```

Rollback of code (does not roll back Mongo):

```bash
git log --oneline -5
git checkout <previous-commit>
# restart the process
```

Prefer reverting with a new commit over rewriting `main`.

Build and restart after pull:

```bash
# server
npm install
# restart the process that runs index.js

# portal
npm install
npm run build
npm start
```

There is no CI config in the files that were listed.

---

## 29. Troubleshooting

### Affiliate login fails

Symptoms: toast with the API message, stay on `/login`.

Causes: unknown mobile, wrong password, `registrationVerified` false, `status === "BLOCKED"` on the server, or `isBlocked` on the NextAuth step.

Check: user document `mobile`, `registrationVerified`, `status`, `isBlocked`. Server log line `Login error`.

Files: `controllers/auth/auth-controller.js` `loginUser`, `src/app/auth.ts` `login`, `src/components/auth/login/login-page.tsx`.

### Login succeeds on the API but the dashboard bounces to login

The API cookie was set and NextAuth `signIn` failed, or the middleware deleted cookies because the user was `BLOCKED` or not found by email.

Check both cookies in the browser: `aff_ses_server` and `aff_ses_tkn`.

### Admin login returns to the login screen

Admin UI is not in this repo. On the API, `authenticateAdmin` returns 401 when `aff-admin-tkn` is missing, the JWT is expired (7 days), or the secret does not match. Cookie `sameSite` is `Strict`, so it is not sent on cross-site requests. Domain must be `.uracca.com` (or unset on localhost).

`GET /api/user/current-admin` is the session check. There is no `GET /api/user/current-user`.

### Campaign does not appear

Affiliate list hides `INACTIVE` campaigns and products with `isActive === false`. `PAUSED` campaigns still show. Also confirm `workingOn` / `accountId` filter. Response `data` must be decrypted; a `DATA_SECRET_KEY` mismatch throws in the client instead of showing rows.

### Product does not appear

`getProductsForUsersFromDb` drops external products whose local row has `isActive === false`. It does not drop `status: "PAUSED"` by itself. Catalog URL failures return the store’s status (or 502). Empty `backendRoutes.products` returns 400 `No products URL found in backendRoutes`.

### Click count stays 0

`TrackClick` never ran, or it returned 403 (user not approved, campaign not `ACTIVE`, product paused). Missing body fields currently surface as 500 `Missing affiliate parameters`. There is no per-click collection to inspect; look at `campaigns.clicks` and `dailyactions`.

### Orders stay 0 / earnings stay 0 / no commission

The store did not call `purchase-campaign`, or the call was rejected. Wallet balance stays 0 until the cron pays a `PENDING` commission. Pending commission is on the commission document and on `commissionDetails.pendingCommission`, not on `wallet.balanceAmount`.

### Product domain mismatch / no valid active products

Local `Product.domain` normalized ≠ `Platform.domain` normalized. Or every line was inactive. Or `ONLY_AFF_PRODUCT` and the campaign product id was not in `productDetails`. Log line: `Error in purchaseOrderWithAffiliateCampaign`.

### Campaign domain mismatch

`createCampaign` does not compare domains. A “mismatch” is usually the link host (`NEXT_PUBLIC_STORE_URL`) differing from `Platform.domain` or from `NpmPackage.domain`. API key failures return `Domain mismatch` when `x-domain` ≠ package domain.

### Affiliate fields missing on the order

The store did not send `referralId` and `campaignAccessKey`. This server does not attach them by itself.

### COD works and Razorpay checkout does not (or the reverse)

Both must be fixed in the store. This server uses one endpoint for both. If one payment method never calls `OrderCampaign`, commissions exist only for the other.

### Razorpay checkout works but commission is missing

Payment verification succeeded in the store and `OrderCampaign` failed or was not called. Search store logs for the affiliate HTTP error. Search `commissions` by `orderId`.

### Production differs from local

Compare `BACKEND_URL`, `NEXT_PUBLIC_STORE_URL`, `DATA_SECRET_KEY`, CORS / `ALLOWED_ORIGINS`, `NpmPackage.domain`, `Platform.domain`, `Product.domain`, cookie domain, and which git commit is running. Localhost skips the API-key host check. Production does not.

### API 500

`errorHandler` log `Error caught by errorHandler`. In development the JSON includes `stack`. Common messages: `Missing affiliate parameters`, `No valid active products found for this order`, `Platform not found for admin`, `No commission defined for this order`, `Failed to encrypt data` (bad `DATA_SECRET_KEY`).

### CORS

Log `Blocked Origin: ...`. Add the exact origin (scheme + host + port) to `ALLOWED_ORIGINS` or the hard-coded list. Restart the server.

### Cookie / JWT

User cookie name `aff_ses_server`, secret `JWT_SECRET_USER`. Admin cookie `aff-admin-tkn`, secret `JWT_SECRET_ADMIN`. Portal page cookie `aff_ses_tkn` is a different NextAuth token. Decrypt errors are `DATA_SECRET_KEY`, not JWT.

### Mongo

Boot log `Can't connect!`. Check `MONGODB_URL`. If the process exits before listen, a required env key is missing (`loadEnv.js`).

### Port in use

`PORT` is taken. Change `PORT` or stop the other process. Default 8000.

### Build failure

Portal: `npm run build`. Fix the TypeScript error Next prints. Server has no build step.

### Old frontend after deploy

`next start` serves `.next`. Run `npm run build` on the server that is actually serving traffic, then restart that process.

### Withdrawal rejected immediately

Invalid PIN, insufficient `balanceAmount`, missing platform, net amount ≤ 0 after fees, or Razorpay contact/fund creation failed (`Invalid UPI/Bank details`). Online method requires UPI id or bank fields on `transactionDetails`.

---

## 30. Debugging Checklist

Use this when an order did not produce commission.

- [ ] Affiliate `users.status` is `APPROVED`
- [ ] Affiliate `registrationVerified` is true
- [ ] Affiliate `workingOn` is the admin who owns the campaign
- [ ] `campaigns.status` is `ACTIVE`
- [ ] `campaigns.campaignAccessKey` equals the `campKey` in the URL
- [ ] `users.campaignAccessKey` contains that key
- [ ] `campaigns.userId` is that affiliate
- [ ] Local `products` row for that `productId`, if it exists, has `isActive: true` and `status` not `PAUSED`
- [ ] `normalizeStoreUrl(products.domain)` equals `normalizeStoreUrl(platforms.domain)` for that admin
- [ ] `platforms.backendRoutes.products` returns JSON the fetcher can read
- [ ] Store URL contains `aff` and `campKey`
- [ ] Store called `POST /api/affiliate/clicks` and got 200 (optional for commission, required for click count)
- [ ] Store called `POST /api/affiliate/purchase-campaign` with the same `referralId`, `campaignAccessKey`, a new `orderId`, and `productDetails`
- [ ] `productDetails[].productId` equals `campaigns.product.productId` when `affType.commissionType` is `ONLY_AFF_PRODUCT`
- [ ] A commission percent exists on the user, the product, or the platform
- [ ] `commissions` has one document for that `orderId`
- [ ] `commissions.userId` and `campaignId` match
- [ ] `campaigns.ordersCount` increased
- [ ] `users.actions.totalOrders` increased
- [ ] `commissions.status` is `PENDING` until `returnPeriod + 1` days
- [ ] After the cron, status is `PAID` and `wallets.balanceAmount` increased for that `userId` + `adminId`
- [ ] Dashboard `workingOn` matches that `adminId` (session wallet is loaded for `workingOn` only)

---

## 31. Business Rules

Rules that are enforced in code. Breaking them changes who gets paid.

1. An affiliate cannot call protected user APIs until `status` is `APPROVED`. OTP verification alone is not approval.
2. `APPROVED` is refused if `registrationVerified` is false.
3. `SPECIAL` and `COMPANY` approval requires `commission > 0`. The check is `commission === 0`, so a missing commission does not trip it.
4. Campaign create requires `workingOn`, and `accountId` must equal `workingOn`.
5. New clicks are counted only for `APPROVED` users, `ACTIVE` campaigns, and a local product that is not inactive or paused (if a local row exists).
6. New commissions use the same gates. Non-active campaigns do not create `HOLD` commissions.
7. One commission per `orderId`.
8. Commission base is the `productAmount` the caller sends, not a server-side price calculation.
9. `ONLY_AFF_PRODUCT` pays only the campaign product lines. `ALL_PRODUCT` pays all valid lines only if the campaign product is in the cart.
10. Percent priority: user `affType.commission`, then local product commission, then store payload commission, then platform commission.
11. TDS comes off the commission, using linked or unlinked platform settings, unless `isTdsEnabled` is false.
12. Wallet balance increases when the cron marks the commission `PAID`, not when the order is attributed.
13. The cron waits `returnPeriod + 1` whole days. A falsy `returnPeriod` is treated as 1, so `0` does not mean “pay immediately”.
14. Cancelling a product line recomputes or cancels the commission. It does not cancel the store order.
15. Withdrawal PIN is required. Balance must cover the requested amount. Transfer fees are platform `bankTransfer` or `onlineTransfer`.
16. Withdrawal minimums are enforced in the portal UI, not in `processWithdrawal`.
17. Online withdrawals must have a Razorpay contact and fund account before the row is created.
18. Razorpay payout API only starts from `PENDING` and then sets `PROCESSING`. Completion is the webhook or an admin `COMPLETED` action.
19. Cash tier rewards credit the wallet only when an admin sets the collected reward to `PAID`, and only once.
20. Store calls must present a valid `NpmPackage` api key. Outside localhost, `x-domain` must match that package’s domain.
21. Product domain must match platform domain when a local product row exists, or the line is blocked.
22. First super admin registration is unauthenticated. After that, only a super admin can register admins.
23. Run a single commission cron. It scans every pending commission every minute.

---

## 32. Security

### What the code does

- Passwords and withdrawal PINs are bcrypt hashes.
- Affiliate and admin JWTs are httpOnly cookies.
- Store routes require an API key.
- Payout webhook checks a Razorpay signature.
- Helmet is enabled.
- Withdrawal POST is limited to 1 per minute.
- Admin registration is closed after the first super admin, except for super admins.
- Campaign responses and commission lists are AES-256-CBC encrypted in transit of the JSON body. The key is also shipped to the browser as `NEXT_PUBLIC_DATA_SECRET_KEY`, so this is obfuscation against casual inspection, not a confidentiality boundary.

### Issues found (do not exploit; fix later)

| Issue | Where | Impact | Remediation |
| --- | --- | --- | --- |
| Product create, commission edit, and product list have no auth | `routes/product-route.js` mounted at `/api/admin/products` and `/api/users/products` | Anyone who can reach the API can read or upsert products | Add `authenticateAdmin` on mutating routes |
| `POST /api/npm/register` has no auth and deactivates every other `NpmPackage` | `routes/npm-route/route.js` | An anonymous caller can mint a key and disable existing keys | Require super admin. Stop flipping all keys to `active: false` |
| `GET /api/admin/platform/general/settings` and `POST /api/admin/ticket/call` have no auth | platform and ticket routers | Public read of settings; public ticket creation (ticket creation may be intentional) | Protect the settings GET |
| `PATCH /api/wallet/recharge/:userId/:adminId` is behind `authenticateUser` | `routes/wallet-route.js` | An approved affiliate can credit a wallet. The button is hidden outside development; the route is not | Restrict to development or to super admin |
| `DATA_SECRET_KEY` is public on the client | `NEXT_PUBLIC_DATA_SECRET_KEY` | Anyone can decrypt campaign and commission payloads the API returns to a logged-in user. They still need the response | Stop encrypting data the browser must decrypt, or keep the key server-side only |
| OTP stored in plaintext | `User.otp` | Database read discloses the current OTP | Store a hash. Short TTL is already `otpExpiry` |
| `cookie-session` keys are the literals `key1` and `key2` | `index.js` | Forged session cookies if that middleware is relied on | Use `SESSION_SECRET` |
| JWT fallback `supersecretkey` | `auth-controller.js`, portal `api/auth/login` | Dangerous if env loading is bypassed | Remove fallbacks |
| Portal `api/auth/login` uses `JWT_SECRET`, server expects `JWT_SECRET_USER` | portal login route | Tokens from that route will not match the server | Delete the unused route or use one secret |
| `generic-update` `$set`s the request body | `updateAffUser` | A client can send fields the UI did not intend, including `status`, `affType`, `userType`, if the route accepts them | Allow-list fields |
| `validatePlatformApiKey` ignores `NpmPackage.active` | middleware | A key deactivated by `/api/npm/register` still works | Check `active` |
| CORS allows missing `Origin` | `index.js` | Browser-less clients are not origin-checked. API key routes still need a key | Keep for webhooks; do not treat missing Origin as a user session |
| Webhook signature result | `razorpay-webhook-integration.js` | Confirm the library throws on a bad signature. If it only returns `false`, failed signatures would still be processed | Abort when validation fails |
| Account deletion sets `BLOCKED` but does not revoke existing JWTs until they expire | settings + JWT | A blocked user can keep calling APIs until the 7-day token dies, except where status is re-read. `authenticateUser` does re-read status, so blocked users are rejected on the next API call. NextAuth middleware checks `BLOCKED` on navigation | Acceptable for API; portal middleware only runs on matched paths |
| Commission cron has no distributed lock | `commissionPayoutJob.js` | Two processes can both credit a wallet if both pass the status claim window incorrectly. The status claim is atomic; wallet credit is a second write | One process only, or a lock |
| `repairAffiliateProductDomains` rewrites data on boot | `config/db.js` | A bad `fallback` domain can move product rows | Run it as a one-off script, not on every boot |

Customer card data is not handled here. Do not log `RAZORPAY_KEY_SECRET`, webhook secrets, or OTP bodies.

---

## 33. Error Handling

### Server JSON

From `errorMiddleware.js`:

| Condition | HTTP | `error` | `message` |
| --- | --- | --- | --- |
| `NotFoundError` | 404 | `NotFoundError` | constructor message |
| `MissingFieldError` / `BadRequestError` | 400 | name | message |
| `UnauthorizedError` and `InvalidError` | 401 | `UnauthorizedError` | message (`InvalidError` overwrites its name) |
| `ForbiddenError` | 403 | `ForbiddenError` | message |
| Duplicate key | 409 | `DuplicateKeyError` | `Duplicate field: ...` |
| Mongoose validation | 400 | `ValidationError` | mongoose message |
| Plain `Error` | 500 | `UnknownError` or the error name | `err.message` |
| Development | same | plus `stack` | |

### Messages you will actually see

| Message | Meaning |
| --- | --- |
| `Not authorized, no token found.` | Cookie/Bearer missing |
| `Invalid or expired token.` | JWT bad or older than 7 days |
| `Access denied. Your account is {status}.` | User JWT valid but status is not `APPROVED` |
| `Please complete OTP verification before logging in` | `registrationVerified` false |
| `User has been blocked` | Login, status `BLOCKED` |
| `Missing affiliate parameters` | Click body missing `referralId` or `campaignAccessKey` (returned as 500) |
| `This campaign key does not belong to the user` | Key not in `user.campaignAccessKey` |
| `Affiliate user is {status}; clicks are not tracked` | Click gate |
| `Campaign is {status}; clicks are not tracked` | Click gate |
| `Product is paused or inactive; clicks are not tracked` | Click gate |
| `user status is : {status}` | Purchase, not approved (HTTP 404) |
| `Invalid campaign key for this user` | Purchase, 403 |
| `Campaign is {status}; no commission recorded` | Purchase, 403 |
| `Campaign product is paused or inactive; no commission recorded` | Purchase, 403 |
| `No valid active products found for this order` | Every line blocked or none returned |
| `This product is not part of the current campaign` | `ONLY_AFF_PRODUCT` and the campaign SKU was not in the cart |
| `No matching campaign product found among purchased items` | `ALL_PRODUCT` and the campaign SKU was absent |
| `No commission defined for this order` | All percent sources are 0 |
| `Platform not found for admin` | No `Platform` for `campaign.company.accountId` |
| `Domain mismatch` | `x-domain` vs `NpmPackage.domain` |
| `Missing headers` | No `x-api-key` or `x-domain` |
| `Invalid apiKey` | Unknown key |
| `Commission already recorded for this order` | Idempotent 200 |
| `Select an active company before creating a campaign` | `workingOn` empty |
| `Campaign account must match your active company` | `accountId` ≠ `workingOn` |
| `Insufficient balance` | Withdrawal |
| `Invalid withdrawal PIN` | Withdrawal |
| `Not allowed by CORS` | Origin rejected. This becomes a CORS error in the browser, often without a JSON body |

### Portal

Login and forms use `sonner` toasts (`MAKE_TOAST_ERROR`). Axios errors read `err.response.data.message`. Decrypt failures throw `Failed to decrypt data` or a crypto exception when the key or payload does not match.

NextAuth `authorize` throws `Mobile number not registered`, `Your account is blocked`, `Please complete OTP verification before logging in`, `Incorrect password`.

---

## 34. Logging and Monitoring

| Place | What you get |
| --- | --- |
| Affiliate server stdout | `morgan("dev")` access log (registered twice), boot line, CORS blocks, cron result every minute, `❌ Error in purchaseOrderWithAffiliateCampaign` |
| `errorHandler` | `Error caught by errorHandler:` plus the error |
| Portal | `next dev` terminal, browser Network tab, `console.error` in login and OTP routes |
| Mongo | The collections in section 19. There is no separate APM |
| Razorpay | Payout id logged as `Payout successful`. Webhook logs `payout.processed` / `failed` / `reversed` |

There is no Sentry (or similar) client in the dependencies that were read.

### Trace an order

```js
db.commissions.find({ orderId: "OD0000000000000001" })
```

Then `userId`, `campaignId`, `adminId`.

### Trace a commission to a wallet

```js
db.wallets.find({
  userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c"),
  adminId: ObjectId("665f0c0c0c0c0c0c0c0c0c0d")
})
```

Look for `transactions.refId` equal to the commission `_id`.

### Trace an affiliate

```js
db.users.find({ referralId: "AFF2601234" }, { password: 0, otp: 0, withdrawalDetails: 0 })
db.campaigns.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") })
db.dailyactions.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") }).sort({ date: -1 })
```

### Production process logs

If the host uses PM2, the usual commands are `pm2 ls` and `pm2 logs <name>`. Process names are not defined in this repo, so read them from the server rather than guessing. If systemd is used, `journalctl -u <unit> -n 200`.

---

## 35. MongoDB Debugging Queries

Use a development database first. These are reads.

```js
// Affiliate
db.users.find(
  { referralId: "AFF2601234" },
  { password: 0, otp: 0, withdrawalDetails: 0 }
)

// Campaigns for that user
db.campaigns.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") })

// One campaign by access key
db.campaigns.find({ campaignAccessKey: "AFF_482193A1B2C3_CAMP" })

// Product on a domain
db.products.find({
  productId: "665f0c0c0c0c0c0c0c0c0c0c",
  domain: "https://www.uracca.com"
})

// Inactive or paused products
db.products.find({ $or: [{ isActive: false }, { status: "PAUSED" }] })

// Clicks are counters, not documents
db.campaigns.find(
  { campaignAccessKey: "AFF_482193A1B2C3_CAMP" },
  { clicks: 1, ordersCount: 1, status: 1 }
)
db.dailyactions.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") }).sort({ date: -1 })

// Commission for an order
db.commissions.find({ orderId: "OD0000000000000001" })

// Pending and paid
db.commissions.find({ status: "PENDING" }).sort({ createdAt: -1 }).limit(20)
db.commissions.find({ status: "PAID" }).sort({ createdAt: -1 }).limit(20)
db.commissions.find({ status: "HOLD" })

// By affiliate or campaign
db.commissions.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") })
db.commissions.find({ campaignId: ObjectId("665f0c0c0c0c0c0c0c0c0c0e") })

// Wallet and withdrawals
db.wallets.find({ userId: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") })
db.withdrawals.find({ user: ObjectId("665f0c0c0c0c0c0c0c0c0c0c") }).sort({ createdAt: -1 })

// Platform and SDK key (do not paste apiKey into tickets)
db.platforms.find({}, { domain: 1, adminId: 1, commission: 1, backendRoutes: 1, returnPeriod: 1 })
db.npmpackages.find({}, { platformName: 1, domain: 1, active: 1 })
```

There is no `orders` collection that attribution writes. `db.orders.find({ orderId })` only returns rows if something else inserted the unused `Order` model.

### Destructive commands

Do not run `deleteMany`, `drop`, `updateMany` without a filter, or `repair`-style rewrites against production unless you have a backup and a written reason. In particular:

- Deleting a `commissions` row does not reverse wallet balance or campaign counters.
- Deleting an `npmpackages` row breaks store clicks and purchases for that domain.
- `POST /api/npm/register` sets every package `active: false` (and the middleware currently ignores `active`, which is its own bug).

---

## 36. End-to-End Examples

### Example 1 — Happy path

Numbers are illustrative. They match the formulas, not a live database.

1. Admin platform commission is 10%. TDS linked is 10% percent. Affiliate is `INDIVIDUAL` with no personal commission override, `ONLY_AFF_PRODUCT`, TDS enabled.
2. Affiliate is `APPROVED`, `workingOn` is that admin.
3. Affiliate starts a campaign. `returnPeriod` stored as 7. Link:

`https://www.uracca.com/products/blue-shirt?aff=AFF2601234&campKey=AFF_482193A1B2C3_CAMP`

4. Customer opens the link. Store calls `TrackClick`. `campaigns.clicks` becomes 1.
5. Customer buys that product. Store sends `productAmount: 1000` and its `orderId`.
6. Commission: gross `100`, TDS `10`, `finalCommission` `90`, status `PENDING`. `ordersCount` is 1. Wallet balance is still 0.
7. After 8 whole days (`7 + 1`), the cron sets `PAID` and `wallets.balanceAmount` increases by 90.
8. Affiliate withdraws 90 with method `ONLINE`, UPI, and a valid PIN. If the online transfer charge is 0, net is 90, balance becomes 0, withdrawal is `PENDING`.
9. Admin calls `PATCH /api/admin/withdrawal/payout`. Status `PROCESSING`, Razorpay payout id stored.
10. Webhook `payout.processed` runs `completeWithdrawal`. Status `COMPLETED`.

### Example 2 — Clicks increase, order count stays 0

1. Confirm `campaigns.clicks` increased. Tracking works. Attribution did not.
2. In the browser Network tab on the **store** checkout, look for `POST /api/affiliate/purchase-campaign`. If it is absent, the store never called `OrderCampaign` (payment handler, missing `aff`/`campKey` in the order payload, or the SDK was not initialised).
3. If the call exists, read the JSON `message`.
   - `Campaign is PAUSED` or product paused: no commission, by design.
   - `No valid active products found for this order`: domain or inactive local product. Compare `products.domain` and `platforms.domain`.
   - `This product is not part of the current campaign`: `productDetails.productId` ≠ `campaign.product.productId`.
   - 500 `Missing required parameters`: the store omitted `orderId` or `productDetails`.
4. If the call returned 200, find `db.commissions.find({ orderId })`. If the dashboard still shows 0, the session `workingOn` admin is not `commissions.adminId`, or the UI is reading wallet balance instead of pending commission.
5. Pending commission does not appear as wallet balance. Check `status`.

### Example 3 — Local works, production does not

Compare:

| Check | Local | Production |
| --- | --- | --- |
| Portal `BACKEND_URL` | `http://localhost:8000` | `https://affiliate.server.uracca.com` |
| `NEXT_PUBLIC_STORE_URL` | `http://localhost:3002/` | production store URL with trailing slash |
| API key host check | localhost skips it | `x-domain` must match `NpmPackage.domain` |
| CORS | `ALLOWED_ORIGINS` includes the local portal | production origins in the allow-list |
| Cookies | no `Domain`, not `Secure` | `Domain=.uracca.com`, `Secure` |
| `DATA_SECRET_KEY` | must match the portal key used in that build | a mismatch decrypts as garbage or throws |
| Database | local cluster | production cluster; campaigns in one are invisible in the other |
| Git SHA | your branch | the SHA the process is actually running |
| Catalog URL | `backendRoutes.products` or `STORE_PRODUCTS_URL` | a localhost catalog URL left in the platform document will fail from the server |
| Cron | your machine | whichever host runs `index.js` |

---

## 37. Local vs Production

| Area | Local (from code) | Production (from code) |
| --- | --- | --- |
| Affiliate portal | `http://localhost:3000` (`next dev`) | `https://affiliate.uracca.com` (CORS) |
| Affiliate server | `http://localhost:8000` unless `PORT` is set | `https://affiliate.server.uracca.com` (SDK default) |
| Store | `http://localhost:3002/` fallback in the campaign button | `https://www.uracca.com`, `uracca.in`, tenant hosts in CORS |
| Admin UI | not in these repos; needs CORS + cookie domain | `https://admin.uracca.com` and tenant `*.admin.uracca.com` |
| Database | `MONGODB_URL` in each `.env` | `MONGODB_URL` in the host env. Both apps must use the same database |
| Portal API base | `BACKEND_URL` or `IP_ADDRESS` | `BACKEND_URL` |
| SDK API base | pass `baseURL` into `InitAffiliate` | default `https://affiliate.server.uracca.com/api` |
| Cookies | no `Domain` on localhost; `secure` false unless Origin is `https` | `Domain` is parent eTLD+1; `secure` true when `NODE_ENV=production` or Origin is `https` |
| Admin cookie | `sameSite: Strict` | same |
| Secrets | local `.env`, not committed (no `.env` was in the tree) | host env. Do not copy production secrets into the portal’s `NEXT_PUBLIC_*` except the data key, which is already public by design |
| Cron | runs on every `npm start` | must run on exactly one production process |
| Catalog override | `STORE_PRODUCTS_URL` if set | leave unset so each platform uses `backendRoutes.products` |

---

## 38. Known Issues and Technical Debt

| Issue | Impact | Location | Current behaviour | Improvement |
| --- | --- | --- | --- | --- |
| Store and admin UI are outside these repos | A new developer cannot see checkout or admin screens here | — | SDK and admin routes are the contract | Keep this document next to those repos’ integration notes |
| Duplicate Mongoose models | Portal and server can drift | `affiliate.server/models` and `affiliate.uracca.com/src/models` | Both connect to the same database | One schema package |
| Two login tokens | Easy to “be logged in” in the UI and 401 on the API | `LoginPage`, `auth.ts`, `loginUser` | `aff_ses_tkn` and `aff_ses_server` | One session |
| `GET /api/user/current-user` does not exist | Dead client | `src/services/user/route.ts` | Defined, unused | Remove or implement |
| Portal `POST /api/auth/login` uses a different JWT secret | Dangerous if wired up | `src/app/api/auth/login/route.ts` | Login page does not call it | Remove |
| Click errors for missing params are HTTP 500 | Store retries and logs look like outages | `trackAffiliateClick` | `throw new Error` | Return 400 |
| Purchase “user not approved” is HTTP 404 | Monitoring treats it as missing URL | same file | `res.status(404)` | Use 403 |
| No click dedupe | Refresh inflates `clicks` | `trackAffiliateClick` | +1 per request | Optional unique window |
| `HOLD` commission is never created anymore | Paused campaigns earn nothing, including orders placed while paused | purchase handler vs cron | 403, cron can still pay old `HOLD` rows | Decide one policy and delete the other |
| Cron does not update `User.commissionDetails` | User pending/paid fields go stale after payout | `commissionPayoutJob.js` | Comment says this is intentional | Read wallet + `commissions`, or update the user fields |
| Wallet commission transaction stays `PENDING` after payout | Status lies | `helper/wallet.js` `addCommissionToWallet` | `status: "PENDING"` while balance is credited | Set `PAID` or call `markCommissionPaid` |
| `returnPeriod` 0 means 1 day | “Immediate” payout is impossible via 0 | cron | `campaign.returnPeriod && campaign.returnPeriod > 0` | Use nullish check |
| `Product.productId` schema ref is ObjectId but values are store id strings | Populate will not resolve | `campaignSchema.js` `product.productId` | Stored as string from the client | Change the schema type to String |
| Product status route missing `/` | Status updates from admin may 404 | `routes/product-route.js` `patch("updateStatus/:id"` | Path does not match the comment | `patch("/:id/status"` |
| Product routes unauthenticated | See Security | `product-route.js` | Open | Add admin auth |
| `updateAffUser` uses `res` inside a function that has no `res` | Generic update crashes for `REJECTED` / `BLOCKED` users | `controllers/user/user-updates.js` | `ReferenceError` | Return a thrown `BadRequestError` |
| `paymentMethods` min/max not enforced on the server | API clients bypass the UI | `processWithdrawal` | Any amount up to balance | Enforce platform limits |
| `ENTITY_ID` and `BREVO_API_KEY` required or listed but unused | Confusing env setup | `loadEnv.js` | Process will not boot without `ENTITY_ID` | Drop or use them |
| `npm start` is nodemon | Production restarts on file changes if this script is used | `package.json` | `nodemon index.js` | `node index.js` for production |
| Domain repair on every boot | Surprising writes | `config/db.js` | Rewrites domains | One-off migration |
| `POST /api/npm/register` deactivates all keys | Can disable every store | `npm-controller.js` | `updateMany active:false` | Do not do this |
| Sidebar component is storefront leftovers | Confusing navigation | `Sidebar_V01_List.tsx` | Links to `/cart`, `/my-account/my-orders` | Affiliate nav is the mobile tab bar |
| Large commented blocks | Old auth, old product fetch, old order test route | `middleware.ts`, `authConfig.ts`, `product-controllers.js`, `index.js` | Dead code | Delete when the live path is confirmed |
| `authenticate` import of `InitAffiliate` and `TrackClick` in `campaign-controller.js` | Unused import | top of `campaign-controller.js` | Imported, not used in `createCampaign` | Remove |
| Referral `level` field | Looks like MLM | `Referring` | Only level 1 is written. No override commission | Do not build payout on `level` until a calculator exists |
| `models/uracca-order.js` | Looks like the system stores orders | only `testings-controllers.js` | Not on the live path | Do not query it for attribution |
| `totalSales` / DailyAction `sales` | Dashboards can show 0 sales while orders exist | purchase handler | Not incremented | Increment with `purchaseAmount` if the business wants sales |
| Admin JWT 7 days vs cookie 30 days | Confusing expiry | `loginAdmin` | Cookie outlives JWT | Make them equal |
| `campaignStarted` gate | New affiliates cannot open wallet/campaigns until the flag is true | `authConfig.ts` | Redirect to `/dashboard` | Confirm which UI sets `campaignStarted` before relying on it |
| Hard-coded CORS and example tenant hosts | New domains need a code or env change | `index.js` | `example.uracca.com` is literally listed | Prefer `ALLOWED_ORIGINS` |

`campaignStarted` is a boolean on the user. The middleware blocks other pages until it is true. Search the portal for writes to that field before changing the gate; this inspection did not find a dedicated “set campaignStarted” server route in the affiliate server user routes. It can be set through generic update because that `$set`s arbitrary fields.

---

## 39. Important File Reference

| Area | File | Purpose |
| --- | --- | --- |
| Server entry | `affiliate.server/index.js` | Routes, CORS, listen |
| Env gate | `affiliate.server/utils/loadEnv.js` | Required variables |
| User model | `affiliate.server/models/aff-user.js` | Affiliate and admin accounts, `referralId` |
| Campaign model | `affiliate.server/models/campaignSchema.js` | Link, clicks, order count |
| Commission model | `affiliate.server/models/commissionSchema.js` | One row per order |
| Product model | `affiliate.server/models/productSchema.js` | Local catalog mirror |
| Platform model | `affiliate.server/models/platformSchema.js` | Domain, fees, TDS, catalog URL |
| SDK key model | `affiliate.server/models/npmSchema.js` | `apiKey` |
| Wallet | `affiliate.server/models/walletSchema.js` | Balance |
| Withdrawal | `affiliate.server/models/withdrawalSchema.js` | Payout request |
| Click + commission | `affiliate.server/controllers/campaign/track-aff-container.js` | `trackAffiliateClick`, `purchaseOrderWithAffiliateCampaign` |
| Campaign CRUD | `affiliate.server/controllers/campaign/campaign-controller.js` | Link generation |
| TDS | `affiliate.server/controllers/campaign/calculateTDS.js` | |
| Cancel commission | `affiliate.server/controllers/wallet/wallet-controller.js` | `cancelWalletCommissionAmountFromAff` |
| Credit wallet | `affiliate.server/helper/wallet.js` | `addCommissionToWallet`, `addCashRewardToWallet` |
| Cron | `affiliate.server/cron/commissionPayoutJob.js` | `PENDING` → `PAID` |
| Withdrawal request | `affiliate.server/controllers/withdrawals/withdrawal-controller.js` | `processWithdrawal` |
| Razorpay payout | `affiliate.server/controllers/withdrawals/withdrawal-payout-controller.js` | |
| Settlement | `affiliate.server/helper/withdrawalWallet.js` | complete, reject, fail, reverse |
| Webhook | `affiliate.server/web-hook/razorpay/razorpay-webhook-integration.js` | |
| API key check | `affiliate.server/middleware/validatePlatformApiKey.js` | |
| JWT | `affiliate.server/middleware/middleware.js` | |
| Product domain | `affiliate.server/utils/affiliateProductDomain.js` | |
| Catalog fetch | `affiliate.server/utils/fetchPlatformProducts.js` | |
| Line validation | `affiliate.server/utils/platformProductUtils.js` | Domain mismatch |
| SDK | `affiliate.server/haash-affiliate/src/index.js` | `TrackClick`, `OrderCampaign`, `CancelCommission` |
| Portal auth | `affiliate.uracca.com/src/app/auth.ts` | NextAuth |
| Portal gate | `affiliate.uracca.com/src/middleware.ts` | |
| Login UI | `affiliate.uracca.com/src/components/auth/login/login-page.tsx` | |
| Campaign button | `affiliate.uracca.com/src/components/pages/products/start-campain-button.tsx` | |
| Axios base | `affiliate.uracca.com/src/services/api/routes.ts` | `BACKEND_URL` |
| Decrypt | `affiliate.uracca.com/src/utils/crypt-data.ts` | |

---

## 40. New Developer Onboarding

### Day 1 — Architecture and auth

- Read sections 2, 3, 6, and 41 of this document.
- Run both apps against a **non-production** database (section 26).
- Register, complete OTP, and see `status: PENDING` block `PUT /api/users/campaign/create`.
- Log in and confirm both cookies.
- Trace `LoginPage` → `loginUser` → `authenticateUser`.

### Day 2 — Affiliates, products, campaigns

- Approve a user. Set `workingOn`.
- Read `createCampaign` and create one campaign.
- Compare `campaignLink` with `Platform.domain` and `NEXT_PUBLIC_STORE_URL`.
- Read `getProductsForUsersFromDb` and see local `isActive` hide a product.

### Day 3 — Clicks, attribution, commission

- Call `TrackClick` with curl (section 26).
- Call `purchase-campaign` with a fake `orderId`.
- Read the commission document field by field.
- Change the product to `PAUSED` and repeat both calls. Expect 403.
- Read section 23 before touching the store.

### Day 4 — Wallet, rewards, admin APIs

- See that balance is still 0 while status is `PENDING`.
- Read the cron condition. Do not point it at production.
- Read withdrawal PIN, fees, and Razorpay payout.
- Read tier claim vs admin `PAID` cash credit.
- List admin routes in section 8. The admin UI is another repository.

### Day 5 — Deploy and debug

- Read sections 24, 27, 29, and 30.
- Diff local `.env` names with production **names only**.
- Practice the order checklist on one real `orderId` in a copy of production data, not by replaying payouts.

---

## 41. 30-Minute Quick Reference

1. **Architecture.** Portal (`affiliate.uracca.com`) and affiliate server share MongoDB. The store is a third app that calls `@haash/affiliate`. The admin UI is a fourth app that calls `/api/admin` and `/api/user/admin-login`. Customer checkout is not in the affiliate server.

2. **Repositories.** `affiliate.server` (API, cron, SDK source) and `affiliate.uracca.com` (Next.js portal). Remotes are under `github.com/haashtech`. Branch `main`.

3. **APIs that matter.**
   - `POST /api/user/user-login`
   - `PUT /api/users/campaign/create`
   - `POST /api/affiliate/clicks`
   - `POST /api/affiliate/purchase-campaign`
   - `PATCH /api/affiliate/cancel-amount/:orderId`
   - `POST /api/user/withdrawal/new-withdrawal/:adminId`
   - `PATCH /api/admin/withdrawal/payout`

4. **Collections.** `users`, `campaigns`, `products`, `commissions`, `wallets`, `withdrawals`, `platforms`, `npmpackages`, `dailyactions`.

5. **Services.** There is no order service. Commission is `purchaseOrderWithAffiliateCampaign`. Wallet credit is `addCommissionToWallet`, called only by the cron. Payout settlement is `helper/withdrawalWallet.js`.

6. **Flow.** Approved affiliate creates a campaign → link `?aff=&campKey=` → store calls `TrackClick` → store creates the order → store calls `OrderCampaign` → `PENDING` commission → cron after `returnPeriod + 1` days → wallet balance → withdrawal PIN → Razorpay payout webhook.

7. **Domains.** Portal `https://affiliate.uracca.com`. API `https://affiliate.server.uracca.com/api`. Store `uracca.com` / `uracca.in` and tenant hosts. Admin `admin.uracca.com`.

8. **Rules.** Only `APPROVED` affiliates earn. Only `ACTIVE` campaigns earn. One commission per `orderId`. Percent of the `productAmount` the store sends. TDS before wallet credit. Wallet does not move until the cron. Domain match is required when a local product row exists. One cron process.

9. **Common production failures.** Store never called `purchase-campaign`. Product domain mismatch. Campaign or product not `ACTIVE`. `x-domain` / api key mismatch. `DATA_SECRET_KEY` mismatch so the portal cannot decrypt lists. Cookie domain not `.uracca.com`. Looking at wallet balance while the commission is still `PENDING`. Two app instances both running the cron.

---

## 42. Change History / Maintenance Notes

| Date | Note |
| --- | --- |
| 26 September 2026 | First handover written from `affiliate.server` and `affiliate.uracca.com` on branch `main`. Store checkout source and admin UI source were not in the workspace and are not described beyond the contracts those two repos expose. |

When you change attribution, domains, or payouts, update the matching section here in the same change. The dangerous functions are:

- `purchaseOrderWithAffiliateCampaign`
- `trackAffiliateClick`
- `getAndValidatePlatformProducts`
- `validatePlatformApiKey`
- `commissionPayoutJob.js`
- `processWithdrawal` and `helper/withdrawalWallet.js`
- `createCampaign` link format

Do not “fix” items in section 38 inside an unrelated change. Several of them are user-visible behaviour (paused campaigns earn nothing, wallet balance waits for the cron, `returnPeriod` 0 means 1).
