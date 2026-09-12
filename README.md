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
- It rejects stale, unknown, or excess component SKUs instead of trusting cart line-item properties.
- Strict Tolú and Lima gift rules apply based on order creation time at and after `2026-08-10T07:18:43Z`; earlier orders retain their legacy preorder fulfillment plans. Override either boundary with `TOLU_OFFER_CUTOVER_AT` or `LIMA_OFFER_CUTOVER_AT` if the storefront cutover changes.
- Current Lima fulfillment is exactly five allowed pouches plus stickers and frother; its initial subscription order also gets one bottle, while recurring orders get no gifts.
- Recurring subscription orders are identified by the order source at creation, with the Recharge tag as a fallback. A matching first-subscription bottle line also identifies an initial subscription when its selling plan is not yet visible.
- It skips fulfilled orders and orders with no bundle plan.
- For bundle orders, it rereads the current Shopify order before editing and subtracts existing $0 component SKU quantities. A short Redis lock prevents overlapping webhook deliveries from editing the same order at once.
- It creates components through an order edit with a full line-item discount, so the customer continues to pay only for the paid bundle line.

## Before production

Confirm that the component variants can be order-edited, that each SKU is unique in Shopify, and that each current bundle product writes `_inventory_plan`. The theme update must write `_launch_extras` only while the founding-gifts switch is enabled.
