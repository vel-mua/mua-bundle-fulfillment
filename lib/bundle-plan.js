const FLAVOR_SKUS = new Set([
  "MUA-HYD-TN-15PK",
  "MUA-HYD-IB-15PK",
  "MUA-HYD-GS-15PK",
]);

// The current theme was created for the revised bundle-gift offers at this time.
// No Tolú or Lima orders fall in the transition gap, so it is the safe order-time
// boundary between legacy preorder fulfillment and the current offers.
const DEFAULT_TOLU_OFFER_CUTOVER_AT = "2026-08-10T07:18:43Z";
const DEFAULT_LIMA_OFFER_CUTOVER_AT = "2026-08-10T07:18:43Z";

const BUNDLE_RULES = Object.freeze({
  "MUA-TASI-BUN-26": Object.freeze({
    pouchCount: 1,
    standardGifts: Object.freeze(["MW-STCKRPACK-1"]),
    subscriptionGifts: Object.freeze([]),
  }),
  "MUA-TOLU-BUN-26": Object.freeze({
    pouchCount: 3,
    standardGifts: Object.freeze(["MW-STCKRPACK-1"]),
    subscriptionGifts: Object.freeze(["MW-BTTL-BLACK"]),
  }),
  "MUA-LIMA-BUN-26": Object.freeze({
    pouchCount: 5,
    standardGifts: Object.freeze(["MW-STCKRPACK-1", "MW-FROTH-1"]),
    subscriptionGifts: Object.freeze(["MW-BTTL-BLACK"]),
  }),
});

class BundlePlanValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BundlePlanValidationError";
  }
}

function propertyValue(properties, name) {
  return properties?.find((property) => property?.name === name)?.value;
}

function invalidPlan(message) {
  throw new BundlePlanValidationError(message);
}

function parsePlan(value, label) {
  if (!value) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    try {
      parsed = value.split(",").map((entry) => {
        const match = entry.trim().match(/^(\d+)\s*[×x]\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\(.*\))?$/);
        if (!match) invalidPlan(`${label} has an unrecognized format.`);
        return { sku: match[2], quantity: Number(match[1]) };
      });
    } catch (error) {
      if (error instanceof BundlePlanValidationError) throw error;
      invalidPlan(`${label} has an unrecognized format.`);
    }
  }

  if (!Array.isArray(parsed)) {
    invalidPlan(`${label} must be an array.`);
  }

  return parsed.map((item) => ({
    sku: String(item?.sku || "").trim(),
    quantity: Number(item?.quantity),
  }));
}

function normalize(items, source) {
  const quantities = new Map();
  for (const item of items) {
    if (!item.sku || !Number.isInteger(item.quantity) || item.quantity < 1) {
      invalidPlan(`Invalid ${source} component.`);
    }
    quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.quantity);
  }
  return [...quantities].map(([sku, quantity]) => ({ sku, quantity, source }));
}

function formatPlan(items) {
  if (!items.length) return "none";
  return items
    .slice()
    .sort((left, right) => left.sku.localeCompare(right.sku))
    .map((item) => `${item.quantity}x ${item.sku}`)
    .join(", ");
}

function expectedComponents(skus, source) {
  return skus.map((sku) => ({ sku, quantity: 1, source }));
}

function plansMatch(actual, expected) {
  if (actual.length !== expected.length) return false;
  const expectedBySku = new Map(expected.map((item) => [item.sku, item.quantity]));
  return actual.every((item) => expectedBySku.get(item.sku) === item.quantity);
}

function isRecurringSubscriptionOrder(order) {
  // Recharge's order tags can arrive after orders/create. The order source is
  // present at creation, so it must also identify subscription renewals.
  const source = String(order?.source_name || order?.sourceName || "").trim().toLowerCase();
  if (source === "subscription_contract_checkout_one" || source === "subscription_contract") {
    return true;
  }

  const tags = Array.isArray(order?.tags)
    ? order.tags
    : String(order?.tags || "").split(",");

  return tags.some(
    (tag) => String(tag).trim().toLowerCase() === "subscription recurring order",
  );
}

function hasBundleCandidate(order) {
  return (order?.line_items || []).some((lineItem) => {
    const sku = String(lineItem.sku || "").trim();
    return Boolean(BUNDLE_RULES[sku]
      || propertyValue(lineItem.properties, "_bundle_primary")
      || propertyValue(lineItem.properties, "_inventory_plan")
      || propertyValue(lineItem.properties, "_launch_extras"));
  });
}

function isInitialSubscriptionLine(lineItem, order) {
  if (lineItem?.selling_plan_allocation) return true;
  const group = propertyValue(lineItem?.properties, "_bundle_group");
  return Boolean(group && (order?.line_items || []).some((candidate) =>
    candidate.sku === "MW-BTTL-BLACK"
      && propertyValue(candidate.properties, "_bundle_group") === group
      && propertyValue(candidate.properties, "_first_subscription_gift") === "true",
  ));
}

function parsedTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) invalidPlan(`${label} is missing or invalid.`);
  return timestamp;
}

function usesCurrentToluOffer(order, options = {}) {
  const cutoverValue = options.toluOfferCutoverAt
    || process.env.TOLU_OFFER_CUTOVER_AT
    || DEFAULT_TOLU_OFFER_CUTOVER_AT;
  const cutover = parsedTimestamp(cutoverValue, "Tolú offer cutoff");
  const orderedAt = parsedTimestamp(order?.created_at, "Order creation timestamp");
  return orderedAt >= cutover;
}

function usesCurrentLimaOffer(order, options = {}) {
  const cutoverValue = options.limaOfferCutoverAt
    || process.env.LIMA_OFFER_CUTOVER_AT
    || DEFAULT_LIMA_OFFER_CUTOVER_AT;
  const cutover = parsedTimestamp(cutoverValue, "Lima offer cutoff");
  const orderedAt = parsedTimestamp(order?.created_at, "Order creation timestamp");
  return orderedAt >= cutover;
}

function legacyBundlePlan(lineItem, recurringOrder, rule) {
  const properties = lineItem.properties || [];
  const group = propertyValue(properties, "_bundle_group") || String(lineItem.id);
  const inventoryPlan = propertyValue(properties, "_inventory_plan");
  const pouches = recurringOrder
    ? validatePouches(inventoryPlan, String(lineItem.sku || "").trim(), rule)
    : normalize(parsePlan(inventoryPlan, "Inventory plan"), "pouch");
  const pouchComponents = pouches.map((item) => ({ ...item, group }));
  if (recurringOrder) return pouchComponents;

  const gifts = normalize(
    parsePlan(propertyValue(properties, "_launch_extras"), "Launch extras"),
    "gift",
  );
  return [
    ...pouchComponents,
    ...gifts.map((item) => ({ ...item, group })),
  ];
}

function validatePouches(rawPlan, bundleSku, rule) {
  const pouches = normalize(parsePlan(rawPlan, "Inventory plan"), "pouch");
  const disallowed = pouches.filter((item) => !FLAVOR_SKUS.has(item.sku));
  if (disallowed.length) {
    invalidPlan(
      `Bundle ${bundleSku} contains disallowed pouch SKU(s): ${formatPlan(disallowed)}.`,
    );
  }

  const totalQuantity = pouches.reduce((total, item) => total + item.quantity, 0);
  if (totalQuantity !== rule.pouchCount) {
    invalidPlan(
      `Bundle ${bundleSku} requires exactly ${rule.pouchCount} pouch(es); received ${totalQuantity}.`,
    );
  }
  return pouches;
}

function validateGifts(rawPlan, bundleSku, rule, isSubscription) {
  const actual = normalize(parsePlan(rawPlan, "Launch extras"), "gift");
  const allowedSkus = [
    ...rule.standardGifts,
    ...(isSubscription ? rule.subscriptionGifts : []),
  ];
  const expected = expectedComponents(allowedSkus, "gift");
  if (!plansMatch(actual, expected)) {
    invalidPlan(
      `Bundle ${bundleSku} has invalid launch extras. Expected ${formatPlan(expected)}; received ${formatPlan(actual)}.`,
    );
  }
  return actual;
}

function componentPlan(order, options = {}) {
  const components = [];
  const recurringOrder = isRecurringSubscriptionOrder(order);

  for (const lineItem of order.line_items || []) {
    const properties = lineItem.properties || [];
    if (propertyValue(properties, "_bundle_component") === "true") continue;

    const inventoryPlanValue = propertyValue(properties, "_inventory_plan");
    const launchExtrasValue = propertyValue(properties, "_launch_extras");
    const isBundlePrimary = propertyValue(properties, "_bundle_primary") === "true";
    const looksLikeBundle = isBundlePrimary || Boolean(inventoryPlanValue) || Boolean(launchExtrasValue);
    const bundleSku = String(lineItem.sku || "").trim();
    const rule = BUNDLE_RULES[bundleSku];

    if (!rule) {
      if (looksLikeBundle) {
        invalidPlan(`Unrecognized bundle parent SKU ${bundleSku || "(missing)"}.`);
      }
      continue;
    }

    const usesLegacyOffer = (
      bundleSku === "MUA-TOLU-BUN-26" && !usesCurrentToluOffer(order, options)
    ) || (
      bundleSku === "MUA-LIMA-BUN-26" && !usesCurrentLimaOffer(order, options)
    );
    if (usesLegacyOffer) {
      components.push(...legacyBundlePlan(lineItem, recurringOrder, rule));
      continue;
    }

    if (!isBundlePrimary) {
      invalidPlan(`Bundle ${bundleSku} is missing the _bundle_primary marker.`);
    }
    if (Number(lineItem.quantity) !== 1) {
      invalidPlan(`Bundle ${bundleSku} requires a parent quantity of 1.`);
    }

    const group = String(propertyValue(properties, "_bundle_group") || "").trim();
    if (!group) invalidPlan(`Bundle ${bundleSku} is missing its bundle group.`);

    const pouches = validatePouches(inventoryPlanValue, bundleSku, rule);
    components.push(...pouches.map((item) => ({ ...item, group })));
    if (recurringOrder) continue;

    const giftsEnabled = propertyValue(properties, "_bundle_gifts_enabled");
    const gifts = giftsEnabled === "false" || (!launchExtrasValue && giftsEnabled !== "true")
      ? []
      : validateGifts(
        launchExtrasValue,
        bundleSku,
        rule,
        isInitialSubscriptionLine(lineItem, order),
      );

    components.push(...gifts.map((item) => ({ ...item, group })));
  }

  return components;
}

function missingComponents(plan, order) {
  const existingBySku = new Map();
  for (const lineItem of order.line_items || []) {
    const sku = String(lineItem.sku || "").trim();
    const quantity = Number(lineItem.quantity);
    const unitPrice = Number(lineItem.discounted_unit_price);
    if (!sku || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice !== 0) {
      continue;
    }
    existingBySku.set(sku, (existingBySku.get(sku) || 0) + quantity);
  }

  return plan.flatMap((component) => {
    const alreadyAdded = Math.min(component.quantity, existingBySku.get(component.sku) || 0);
    existingBySku.set(component.sku, (existingBySku.get(component.sku) || 0) - alreadyAdded);
    const quantity = component.quantity - alreadyAdded;
    return quantity ? [{ ...component, quantity }] : [];
  });
}

module.exports = {
  BUNDLE_RULES,
  BundlePlanValidationError,
  DEFAULT_LIMA_OFFER_CUTOVER_AT,
  DEFAULT_TOLU_OFFER_CUTOVER_AT,
  componentPlan,
  hasBundleCandidate,
  missingComponents,
  isInitialSubscriptionLine,
  isRecurringSubscriptionOrder,
  propertyValue,
  usesCurrentLimaOffer,
  usesCurrentToluOffer,
};
