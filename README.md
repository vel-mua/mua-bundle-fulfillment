# Mua Bundle Fulfillment

Private Vercel service for Mua Wellness bundle fulfillment.

It receives Shopify `orders/create` webhooks, reads `_inventory_plan` and `_launch_extras` from bundle line-item properties, and uses Shopify order edits to add the selected pouch and qualifying preorder-gift variants as zero-dollar order lines. Shopify and Recharge renewal orders both arrive through the same webhook.

## Deployment setup

1. Deploy this repository to a Vercel production project.
2. Add the values in `.env.example` as Vercel environment variables. The Upstash integration supplies its Redis values automatically.
3. Set the Shopify app's App URL to the Vercel deployment URL.
4. Add `/api/auth/callback` as the Shopify app redirect URL, then open `/api/auth/install` once while signed in to install the app. The Admin token is stored privately in Redis.
5. Subscribe the app to Shopify's `orders/create` webhook and point it at `/api/webhooks/orders-create`.
5. Send a test bundle order before enabling the automation for customer orders.

## Safety rules

- The service rejects webhooks with an invalid Shopify signature.
- The paid parent bundle SKU is the source of truth for pouch count and eligible gifts.
- Saved pouch and gift plans describe one bundle. Each validated plan is multiplied by the current paid parent quantity, so a line containing three Tasi bundles receives three selected pouches and its per-bundle first-order gifts. Renewals still omit all gifts. Invalid quantities and quantities outside Shopify's supported range are rejected.
- It rejects stale, unknown, or excess component SKUs instead of trusting cart line-item properties.
- Older preorder subscriptions that saved only pouch variant IDs are supported through an explicit mapping of the three verified original flavor variants. Unknown IDs and mismatched SKU/variant pairs are rejected; flavor labels are never used to guess a SKU.
- Strict Tolú and Lima gift rules apply based on order creation time at and after `2026-08-10T07:18:43Z`; earlier orders retain their legacy preorder fulfillment plans. Override either boundary with `TOLU_OFFER_CUTOVER_AT` or `LIMA_OFFER_CUTOVER_AT` if the storefront cutover changes.
- Current Lima fulfillment is exactly five allowed pouches plus stickers and frother; its initial subscription order also gets one bottle, while recurring orders get no gifts.
- Recurring subscription orders are identified by the order source at creation, with the Recharge tag as a fallback. A matching first-subscription bottle line also identifies an initial subscription when its selling plan is not yet visible.
- If Shopify's fresh order snapshot has not populated its source or tags yet, the service uses those values from the signed webhook. Renewals ignore inherited first-order gift properties.
- Current bundles with the founding-gifts switch off have no gift component plan. The theme writes `_bundle_gifts_enabled=false`; older bundles without any gift property also fulfill their pouches without gifts.
- It skips fulfilled orders and orders with no bundle plan.
- For bundle orders, it rereads the current Shopify order before editing and subtracts existing $0 component SKU quantities. A short Redis lock prevents overlapping webhook deliveries from editing the same order at once.
- Multiple bundles can share a pouch flavor. Missing quantities are added on separate fully discounted lines, including when the order already contains a paid pouch or a partial set of free pouches. Replays still subtract existing free quantities before editing.
- It creates components through an order edit with a 100% line-item discount, keeping every added unit free regardless of quantity or contextual pricing. The customer continues to pay only for the paid bundle line.

## Historical subscription coverage

Run `npm test`. The September 25, 2026 audit reviewed all 647 available orders and identified 51 subscription-related orders, including 29 from the preorder period and 12 renewals. Sanitized fixtures preserve their subscribed product lines and bundle properties, plus two one-time bundle siblings from mixed carts. See [fixture provenance](test/fixtures/README.md).

Each snapshot is exercised as a future tagless renewal through the webhook, current-order read, order-edit mutations, and a replay. Tests independently check selected flavor quantities, full discounts, gift exclusion, and unchanged paid lines. The Shopify mock rejects repeated variants unless the mutation explicitly allows them, covering the two-Lima preorder case and partial-component recovery.

The September 28 follow-up adds MUA1656's previously unseen parent-quantity pattern: three Golden Sunrise Tasi bundles on one line and one Tropical Nectar Tasi bundle on another. Tests cover its initial four pouches plus four sticker packs, pouch-only renewal, partial recovery, and replay, along with multiple-quantity Tolu, Lima, and legacy JSON plans.

## Before production

Confirm that the component variants can be order-edited, that each SKU is unique in Shopify, and that each current bundle product writes `_inventory_plan`. The theme update must write `_launch_extras` only while the founding-gifts switch is enabled and must write `_bundle_gifts_enabled` explicitly. A genuinely invalid pouch or promised-gift plan still receives 422 and needs operator attention.
