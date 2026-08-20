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
- Strict Tolú gift rules apply at and after `2026-08-10T07:18:43Z`; earlier Tolú orders retain the legacy fulfillment plan. Override the boundary with `TOLU_OFFER_CUTOVER_AT` if the storefront cutover changes.
- It skips fulfilled orders and orders with no bundle plan.
- It skips components that Shopify already added, making webhook retries safe.
- It creates components through an order edit with a full line-item discount, so the customer continues to pay only for the paid bundle line.

## Before production

Confirm that the component variants can be order-edited, that each SKU is unique in Shopify, and that each current bundle product writes `_inventory_plan`. The theme update must write `_launch_extras` only while the founding-gifts switch is enabled.
