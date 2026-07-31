# Mua Bundle Fulfillment

Private Vercel service for Mua Wellness bundle fulfillment.

It receives Shopify `orders/create` webhooks, reads `_inventory_plan` and `_launch_extras` from bundle line-item properties, and uses Shopify order edits to add the selected pouch and qualifying preorder-gift variants as zero-dollar order lines. Shopify and Recharge renewal orders both arrive through the same webhook.

## Deployment setup

1. Deploy this repository to a Vercel production project.
2. Add the values in `.env.example` as Vercel environment variables. Keep the Admin API token and API secret private.
3. Set the Shopify app's App URL to the Vercel deployment URL.
4. Subscribe the app to Shopify's `orders/create` webhook and point it at `/api/webhooks/orders-create`.
5. Send a test bundle order before enabling the automation for customer orders.

## Safety rules

- The service rejects webhooks with an invalid Shopify signature.
- It skips fulfilled orders and orders with no bundle plan.
- It skips components that Shopify already added, making webhook retries safe.
- It creates components through an order edit with a full line-item discount, so the customer continues to pay only for the paid bundle line.

## Before production

Confirm that the component variants can be order-edited, that each SKU is unique in Shopify, and that each current bundle product writes `_inventory_plan`. The theme update must write `_launch_extras` only while the founding-gifts switch is enabled.
