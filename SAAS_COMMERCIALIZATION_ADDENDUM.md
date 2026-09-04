# SaaS Commercialization, Subscriptions & Paywall Addendum

This document is the product and architecture source of truth for the commercial version of the jewellery ERP application.

## 1. Product intent

- The product is a multi-tenant SaaS, not a single-shop app.
- Each jewellery business is a tenant.
- The recurring fee is for software access, convenience, and support.
- The customer always retains ownership of their business data.

## 2. Core data boundary

### Customer-owned business data

These records remain in the customer’s Google account, primarily in Google Sheets and Google Drive:

- Suppliers
- Supplier contact information
- Purchases
- Payments
- Metal balances
- Settlements
- Supplier ledgers
- Attachments
- Supplier statements
- Reconciliation data
- Audit history for business transactions
- Backups
- Financial reports

### SaaS control plane data

The SaaS platform may store only platform-management information, such as:

- Tenant ID
- Business name
- Owner user ID
- Owner email
- Google subject ID
- Subscription status
- Plan ID
- Trial dates
- Billing customer and subscription IDs
- Current billing period dates
- Cancellation flags
- Account status
- Feature entitlements
- User limits
- Billing metadata
- Processed webhook IDs

The control plane must never store supplier ledger content or other jewellery business records.

## 3. Tenant model

Create a `Tenant` entity in the SaaS control plane with fields like:

- `id`
- `businessName`
- `ownerUserId`
- `status`
- `planId`
- `trialStartedAt`
- `trialEndsAt`
- `subscriptionStatus`
- `billingCustomerId`
- `billingSubscriptionId`
- `currentPeriodStart`
- `currentPeriodEnd`
- `cancelAtPeriodEnd`
- `createdAt`
- `updatedAt`
- `lastAccessAt`

## 4. User model

Create a SaaS-level user model with fields like:

- `id`
- `tenantId`
- `email`
- `googleSubjectId`
- `name`
- `role`
- `status`
- `createdAt`
- `lastLoginAt`

## 5. Plans and pricing

### Initial commercial offer

- Plan code: `PRO`
- Price: `₹1,999/month`
- Currency: `INR`
- Recommended trial: `14 days`

### Planned future flexibility

Support configurable:

- Monthly plans
- Annual plans
- Free trials
- Promotional discounts
- Coupon codes
- Grandfathered pricing
- Different feature tiers
- Add-on users
- Multi-branch upgrades

Plan structure should use immutable plan codes, not display names, for logic.

## 6. Trial behavior

- New businesses start in `TRIALING`.
- Default trial length: 14 days.
- Trial users should get access to the full core product.
- Trial expiration messaging should show remaining days.
- Trial onboarding should initially work without requiring a payment method.

## 7. Subscription states

Support these subscription states:

- `TRIALING`
- `ACTIVE`
- `PAST_DUE`
- `PAYMENT_FAILED`
- `CANCEL_AT_PERIOD_END`
- `CANCELLED`
- `EXPIRED`
- `SUSPENDED`
- `ADMIN_COMP`
- `ADMIN_BLOCKED`

Access decisions must be centralized and must not be inferred only from dates.

## 8. Entitlement service

Create a centralized `SubscriptionEntitlementService` responsible for:

- `getTenantSubscription()`
- `isTrialActive()`
- `isSubscriptionActive()`
- `canUseApplication()`
- `getFeatureEntitlements()`
- `getAccountMode()`
- `getPlanLimits()`

Account modes:

- `FULL_ACCESS`
- `READ_ONLY`
- `BLOCKED`

The UI and backend should consume this service rather than scattering subscription checks across the app.

## 9. Paywall policy

Subscription is for application access, not data ownership.

When subscription access ends:

- Keep customer Google data intact
- Do not delete Sheets or Drive documents
- Do not delete backups
- Do not encrypt or hold data hostage
- Switch the app to read-only mode

### Read-only mode should still allow

- Sign in
- View dashboard
- View suppliers
- View supplier ledgers
- View reports
- Download or export data
- Access the customer’s Google files

### Read-only mode should block

- Creating or editing suppliers
- Creating transactions
- Recording payments
- Recording metal movement
- Settlements
- Adjustments
- Reconciliation
- Inviting users
- Premium operational features

## 10. Billing architecture

Implement billing behind a provider abstraction.

### Billing provider interface

- `createCustomer()`
- `createSubscription()`
- `cancelSubscription()`
- `resumeSubscription()`
- `getSubscription()`
- `createCheckout()`
- `handleWebhook()`
- `verifyWebhook()`
- `getInvoices()`

### Initial provider

- `RazorpayBillingProvider`

The architecture should allow future providers later.

## 11. Webhooks and billing security

- Billing state must be driven primarily by verified webhook events.
- Webhook handling must be idempotent.
- Store processed webhook IDs.
- Verify webhook signatures.
- Never trust subscription status from the browser.
- Every paid mutation must verify entitlement server-side.

## 12. Payment failure and cancellation

- Do not disable access immediately after one failed payment.
- Use a configurable grace period, recommended at 3 days.
- If a customer cancels, keep access until `currentPeriodEnd`.
- After expiry, move the tenant to read-only mode, not data deletion.

## 13. Paywalled features

Require an active subscription for writes such as:

- Supplier management
- Purchases and returns
- Money receipts and payments
- Metal transactions
- Settlements
- Adjustments
- Reconciliation
- Opening balances
- Period close
- User and permission management
- Advanced reports
- Automatic backups
- Multi-device write access
- Premium integrations

## 14. Feature entitlements and limits

Use configurable feature keys rather than hard-coded plan checks.

Example feature keys:

- `supplier_management`
- `transaction_entry`
- `metal_ledger`
- `money_ledger`
- `settlements`
- `reconciliation`
- `advanced_reports`
- `automatic_backup`
- `multi_user`
- `multi_branch`
- `attachments`
- `exports`
- `audit_log`
- `balance_confirmation`
- `whatsapp_sharing`
- `advanced_analytics`

Support configurable limits such as:

- `maxUsers`
- `maxBranches`
- `maxActiveSuppliers`
- `maxMonthlyTransactions`
- `attachmentStoragePolicy`
- `backupRetentionDays`
- `automaticBackupEnabled`

## 15. Admin area

Create a separate secure SaaS admin area at `/admin`.

It may show:

- Total tenants
- Active subscriptions
- Trials
- Trials expiring
- MRR
- ARR
- Cancelled accounts
- Past-due subscriptions
- New registrations
- Conversion stats
- Plan data
- Coupon usage

It must not expose supplier ledger data.

## 16. Manual onboarding and complimentary access

Support admin-assisted onboarding for the first customers.

Admin actions may include:

- Create tenant
- Send invitation
- Extend trial
- Comp a subscription
- Suspend account
- Reactivate account
- Change plan
- Apply promotional entitlement

Support complimentary accounts with metadata such as:

- `compReason`
- `compStartedAt`
- `compEndsAt`
- `grantedBy`

## 17. Customer onboarding flow

Recommended flow:

1. Landing page
2. Continue with Google
3. Create account
4. Activate 14-day trial
5. Create jewellery ledger in the customer’s Google Drive
6. Business setup
7. Add first supplier
8. Record first transaction
9. Trial conversion
10. Razorpay subscription
11. Active subscription

## 18. Customer trust message

The public positioning should be:

- Your jewellery supplier ledger stays in your Google Drive
- We keep only what is needed to operate the SaaS
- Cancelling the subscription does not delete your Drive files
- You can export your information

## 19. Non-negotiable principles

- Do not hard-code pricing throughout the app.
- Do not scatter subscription checks in UI components.
- Do not store customer ledger content in the control plane.
- Do not delete customer data on non-payment.
- Do not make the trial too restrictive to understand value.
- Do not trust the browser for billing authority.

## 20. Implementation priority

Recommended order:

1. Google-owned ledger architecture
2. Tenant/control-plane architecture
3. Entitlement service
4. Trial system
5. Read-only paywall
6. Razorpay test integration
7. Webhook handling
8. Billing page
9. Admin tenant/subscription screen
10. Production billing

## 21. Commercial success target

A new jewellery shop owner should be able to:

- Sign in with Google
- Start a trial without contacting the founder
- Create a private ledger
- Add suppliers and transactions
- Upgrade to paid access
- Continue using the app automatically
- Cancel and later renew
- Retain all underlying Google data throughout

## 22. Full SRS Coverage Matrix

The original request contains 54 numbered sections. The following matrix preserves every section and records the current state of this repository.

| Original section | Requirement coverage | Current repository state |
|---|---|---|
| 1. Critical data architecture change | Customer ledger data belongs in the customer's Google account | Partially implemented: the ledger adapter is isolated, but Google storage is not connected |
| 2. SaaS control plane | Store only tenant, user, plan, billing, and platform metadata | Partially implemented with in-memory metadata stores |
| 3. Strict privacy boundary | Never persist supplier or financial ledger content in control plane | Implemented for protected field names; requires stronger schema enforcement in production |
| 4. Tenant model | Tenant fields and tenant isolation | Partially implemented |
| 5. User model | SaaS user identity, role, and status | Not implemented; onboarding currently accepts an email as an owner ID |
| 6. Subscription plans | Configurable plan entity and initial PRO pricing | Partially implemented |
| 7. Future pricing structure | Annual, coupons, tiers, add-on users, branches, grandfathering | Data model and workflows not implemented |
| 8. Initial commercial offer | PRO at INR 1,999/month with configurable pricing | Partially implemented in the default plan |
| 9. Free trial | 14-day full-feature trial and expiry reminders | Trial dates exist; reminders and full expiry UX are not implemented |
| 10. Trial without payment method | Start trial without a card | Implemented in local onboarding |
| 11. Subscription status | All listed lifecycle states | Constants exist; lifecycle transitions are incomplete |
| 12. Entitlement service | One centralized service for access and limits | Implemented for core modes and write access |
| 13. Paywall philosophy | Preserve customer data and switch to read-only | Partially implemented; Google data preservation is not yet connected |
| 14. Read-only mode | Reads, exports, and Drive access remain available | Partially implemented; reads remain available, exports and Drive access are absent |
| 15. Paywalled core features | Gate all listed operational writes | Partially implemented; supplier and transaction creation are gated |
| 16. Never-held-hostage features | Existing data and manual export remain available | Partially implemented; export and Drive access are absent |
| 17. Billing provider | Provider interface and Razorpay implementation | Interface is a stub; only Razorpay webhook verification is implemented |
| 18. India-first billing | Razorpay recurring subscriptions and hosted checkout | Not connected to Razorpay checkout or recurring subscription APIs |
| 19. Payment webhooks | Verified, idempotent lifecycle event processing | Signature verification and event deduplication implemented; event mapping is minimal |
| 20. Payment failure | Configurable three-day grace period | Not implemented |
| 21. Cancellation | Period-end cancellation and resume | Not implemented |
| 22. Billing page | Status, cycle, invoices, history, billing actions | Basic plan screen exists; invoice and lifecycle actions are absent |
| 23. Paywall UI | Contextual paywall modal with renewal path | Basic subscription modal exists; expired-action flow is incomplete |
| 24. Trial expiry screen | Runtime-safe metrics and read-only continuation | Not implemented |
| 25. Feature entitlements | Configurable feature keys | Partially implemented with plan feature arrays; full key catalog is not enforced |
| 26. Plan limits | Users, branches, suppliers, transactions, storage, backups | Only users and branches are currently represented |
| 27. Recommended PRO plan | Full initial jewellery operations feature set | Only supplier and money transaction MVP is available |
| 28. Future upsell features | Branches, advanced users, WhatsApp, analytics, automation, branding, support | Not implemented; should remain future roadmap |
| 29. SaaS admin panel | Secure `/admin` with SaaS metrics only | Not implemented |
| 30. Tenant management | Search and admin lifecycle actions without ledger access | Not implemented |
| 31. Complimentary accounts | ADMIN_COMP with reason, dates, and grantor | Status constant exists; admin workflow and metadata are absent |
| 32. Coupons and promotions | Coupon metadata and future redemption support | Not implemented |
| 33. Referrals | Referral attribution metadata | Not implemented; correctly deferred |
| 34. Sales-assisted activation | Manual tenant creation, invitations, sales notes | Not implemented |
| 35. Customer onboarding flow | Google login, Drive ledger creation, setup, trial, conversion | Local email onboarding exists; Google OAuth and Drive setup are absent |
| 36. Landing page | Public value proposition and free-trial CTA | Current root is the authenticated app/onboarding shell, not a separate landing page |
| 37. Pricing page | PRO pricing and future annual support | Basic billing card exists; public pricing page is absent |
| 38. Customer trust page | `/data-ownership` with accurate privacy language | Not implemented |
| 39. Account deletion | SaaS-only, app-access removal, and explicit Drive deletion choices | Not implemented |
| 40. Disconnect Google | Revoke access without deleting Drive data | Not implemented |
| 41. Control-plane database | Reliable hosted relational persistence | Not implemented; current store is in-memory |
| 42. Billing security | Authenticated server-side authorization for every paid mutation | Write gate exists, but authentication and authorization are not implemented |
| 43. Write-gate | Central `assertCanPerformPaidWrite(tenantId, feature)` boundary | Partially implemented as a centralized tenant write check |
| 44. Data access after expiry | Read plus export, no write | Read-only mode exists; export is absent |
| 45. Never delete for non-payment | No customer data deletion on non-payment | No deletion workflow exists in this MVP |
| 46. Application startup | Authenticate, resolve tenant, validate Google, load ledger, render mode | Local tenant bootstrap exists; auth and Google validation are absent |
| 47. Development environments | Separate development, staging, and production credentials/data | Not implemented |
| 48. Razorpay test mode | Test subscription lifecycle scenarios | Only HMAC and idempotency tests exist |
| 49. Analytics | Non-sensitive SaaS events only | Not implemented |
| 50. MRR | MRR, ARR, conversion, churn, and movement metrics | Not implemented |
| 51. SaaS MVP priority | Preserve ledger correctness while adding commercialization | This repository starts the control-plane and entitlement slice; the full order remains roadmap |
| 52. First commercial release | Google login, owned ledger, full jewellery workflows, billing, admin | Not yet achieved; this is an MVP foundation |
| 53. Commercial success criteria | Self-serve trial through subscription, cancellation, and renewal | Not yet achieved |
| 54. Core business principle | Charge for software, never ownership of business records | Documented and reflected in the control-plane boundary |

## 23. Explicit Completion Gate

This repository must not be described as production-ready or as satisfying the full commercial SRS until the following are complete:

- Google OAuth plus customer-owned Sheets/Drive storage
- Persistent control-plane database and authenticated multi-tenant access
- Full supplier, money, metal, settlement, reconciliation, backup, restore, export, and audit workflows
- Razorpay test and production lifecycle integration, including grace period and cancellation/resume
- Secure SaaS admin area with MRR and tenant lifecycle tools
- Account deletion and Google disconnect flows that preserve customer data by default
- Separate landing, pricing, and data-ownership pages
- Automated tests for tenant isolation, lifecycle transitions, write-gates, exports, and billing retries

The current app is a local runnable MVP, not the completed commercial release described by the original SRS.
