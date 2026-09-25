# Subscription history fixtures

Collected read-only from Mua's Shopify order history on September 25, 2026, through 18:36 UTC. All 647 orders were paginated, with no truncated line-item connections. Subscription identification used selling plans, subscription tags, and subscription order sources; all 51 matching orders had selling-plan lines.

`subscription-history.json` contains 51 anonymous subscription-order snapshots (52 subscribed lines), plus two separate one-time bundle siblings for additional format coverage. Subscription projections retain only subscribed lines, so a one-time product in the original mixed cart is not projected into that customer's renewal. One canceled preorder is included for format coverage; no tests imply an active subscription or trigger real billing.

The 52 subscribed lines comprise:

| Format | Lines |
| --- | ---: |
| Legacy variant-ID JSON, Lima | 6 |
| Legacy variant-ID JSON, Tolu | 2 |
| SKU text, Lima | 3 |
| SKU text, Tolu | 16 |
| SKU text, Tasi | 1 |
| Direct pouch, Golden Sunrise | 10 |
| Direct pouch, Tropical Nectar | 7 |
| Direct pouch, Island Breeze | 7 |

Order IDs, order numbers, customer details, original group IDs, and dates are excluded. Case IDs and bundle groups are synthetic. Product identifiers and bundle properties retain the actual saved formats. Private audit exports and the case-to-order mapping remain outside this repository.

Expected bundle quantities were counted from `Pouch 1` through `Pouch 5` and independently cross-checked against the human-readable `Flavors` summary. They were not generated with the production inventory-plan parser. Direct pouch subscriptions have no additional bundle components.

`subscription-03` contains two Lima subscriptions with different bundle groups: together they require 4 Tropical Nectar, 3 Island Breeze, and 3 Golden Sunrise pouches. This fixture reproduced Shopify's duplicate-variant rejection before `allowDuplicates: true` was added. The tests also cover partial free components and a paid same-flavor pouch already on the order, and replay each successful edit to check idempotency.

Coverage is historical Shopify order data, not a live Recharge contract inventory. Shopify API behavior is mocked using its documented duplicate-variant rule; the tests do not create live renewals or charge customers. The mutation was validated against Shopify's Admin schema. See [orderEditAddVariant documentation](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/orderEditAddVariant).
