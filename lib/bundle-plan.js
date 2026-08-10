function propertyValue(properties, name) {
  return properties?.find((property) => property?.name === name)?.value;
}

function parsePlan(value, label) {
  if (!value) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(value);
  } catch (_error) {
    parsed = value.split(",").map((entry) => {
      const match = entry.trim().match(/^(\d+)\s*[×x]\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\(.*\))?$/);
      if (!match) throw new Error(`${label} has an unrecognized format.`);
      return { sku: match[2], quantity: Number(match[1]) };
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array.`);
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
      throw new Error(`Invalid ${source} component.`);
    }
    quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.quantity);
  }
  return [...quantities].map(([sku, quantity]) => ({ sku, quantity, source }));
}

function isRecurringSubscriptionOrder(order) {
  const tags = Array.isArray(order?.tags)
    ? order.tags
    : String(order?.tags || "").split(",");

  return tags.some(
    (tag) => String(tag).trim().toLowerCase() === "subscription recurring order",
  );
}

function componentPlan(order) {
  const components = [];
  const includeLaunchExtras = !isRecurringSubscriptionOrder(order);

  for (const lineItem of order.line_items || []) {
    const properties = lineItem.properties || [];
    if (propertyValue(properties, "_bundle_component") === "true") continue;

    const inventoryPlan = parsePlan(propertyValue(properties, "_inventory_plan"), "Inventory plan");
    const launchExtras = includeLaunchExtras
      ? parsePlan(propertyValue(properties, "_launch_extras"), "Launch extras")
      : [];
    const group = propertyValue(properties, "_bundle_group") || String(lineItem.id);

    components.push(...normalize(inventoryPlan, "pouch").map((item) => ({ ...item, group })));
    components.push(...normalize(launchExtras, "gift").map((item) => ({ ...item, group })));
  }

  return components;
}

function existingComponentKeys(order) {
  return new Set(
    (order.line_items || [])
      .filter((lineItem) => propertyValue(lineItem.properties, "_bundle_component") === "true")
      .map((lineItem) => `${propertyValue(lineItem.properties, "_bundle_group")}:${lineItem.sku}`),
  );
}

module.exports = { componentPlan, existingComponentKeys, isRecurringSubscriptionOrder, propertyValue };
