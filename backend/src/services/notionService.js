const { Client } = require("@notionhq/client");

const notion = process.env.NOTION_API_KEY ? new Client({ auth: process.env.NOTION_API_KEY }) : null;

function requireNotionEnv() {
  if (!notion) {
    throw new Error("NOTION_API_KEY is missing.");
  }
  if (!process.env.NOTION_CARD_REGISTRY_DB_ID || !process.env.NOTION_PRICE_HISTORY_DB_ID) {
    throw new Error("NOTION_CARD_REGISTRY_DB_ID and NOTION_PRICE_HISTORY_DB_ID are required.");
  }
}

function requirePortfolioEnv() {
  if (!process.env.NOTION_PORTFOLIO_DB_ID) {
    throw new Error("NOTION_PORTFOLIO_DB_ID is required for buy records.");
  }
}

function buildCardTitle(entry) {
  return [entry.set_name, entry.driver, entry.parallel, entry.serial_number].filter(Boolean).join(" ");
}

async function findCardByTitle(cardTitle) {
  const res = await notion.databases.query({
    database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
    filter: {
      property: "Card ID",
      title: { equals: cardTitle },
    },
  });
  return res.results[0] || null;
}

function selectValue(name) {
  return name ? { select: { name } } : undefined;
}

function multiSelectValue(value) {
  if (!value) return undefined;
  let items;
  if (Array.isArray(value)) {
    items = value.filter(Boolean);
  } else if (typeof value === "string") {
    items = value.split(/\s*\/\s*/).filter(Boolean);
  } else {
    return undefined;
  }
  if (items.length === 0) return undefined;
  return { multi_select: items.map((name) => ({ name })) };
}

function normalizePlatform(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "Others";
  }
  if (["ebay", "e-bay"].includes(raw)) {
    return "eBay";
  }
  if (["xianyu", "闲鱼"].includes(raw)) {
    return "Xianyu";
  }
  if (["katao", "taobao", "淘宝"].includes(raw)) {
    return "Katao";
  }
  if (["carousell"].includes(raw)) {
    return "Carousell";
  }
  if (["others", "other", "unknown"].includes(raw)) {
    return "Others";
  }
  return "Others";
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return null;
  }
  return n;
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

async function createCard(entry, cardTitle) {
  return notion.pages.create({
    parent: { database_id: process.env.NOTION_CARD_REGISTRY_DB_ID },
    properties: compactProperties({
      "Card ID": { title: [{ text: { content: cardTitle } }] },
      Set: selectValue(entry.set_name),
      "Card Type": selectValue(entry.card_type),
      Driver: multiSelectValue(entry.driver),
      Parallel: selectValue(entry.parallel),
      "Serial Print Run": { rich_text: [{ text: { content: entry.serial_number || "" } }] },
    }),
  });
}

async function createPriceHistory(entry, cardPageId) {
  const files = (entry.attachments || [])
    .filter((f) => f?.url && /^https?:\/\//.test(f.url))
    .map((f) => ({
    name: f.name || "screenshot",
    external: { url: f.url },
  }));

  return notion.pages.create({
    parent: { database_id: process.env.NOTION_PRICE_HISTORY_DB_ID },
    properties: compactProperties({
      Card: { relation: [{ id: cardPageId }] },
      Date: { date: { start: entry.date || new Date().toISOString().slice(0, 10) } },
      Price: { number: numberValue(entry.price) },
      Currency: selectValue(entry.currency || "USD"),
      Platform: selectValue(normalizePlatform(entry.platform)),
      "Record Type": selectValue(entry.record_type || "Market"),
      Notes: { rich_text: [{ text: { content: entry.notes || "" } }] },
      Screenshot: files.length ? { files } : undefined,
    }),
  });
}

async function createPortfolioLot(entry, cardPageId) {
  const lotId = entry.lot_id || `${entry.date || new Date().toISOString().slice(0, 10)} ${buildCardTitle(entry)}`.trim();
  return notion.pages.create({
    parent: { database_id: process.env.NOTION_PORTFOLIO_DB_ID },
    properties: compactProperties({
      "Lot ID": { title: [{ text: { content: lotId } }] },
      Card: { relation: [{ id: cardPageId }] },
      "Buy Date": { date: { start: entry.date || new Date().toISOString().slice(0, 10) } },
      "Buy Price": { number: numberValue(entry.price) },
      Quantity: { number: numberValue(entry.quantity) || 1 },
      Fees: { number: numberValue(entry.fees) || 0 },
      Status: selectValue(entry.status || "Holding"),
      Notes: { rich_text: [{ text: { content: entry.notes || "" } }] },
    }),
  });
}

async function updateCardMarketSnapshot(cardPageId, entry) {
  const entryDate = entry.date || new Date().toISOString().slice(0, 10);
  await notion.pages.update({
    page_id: cardPageId,
    properties: compactProperties({
      "Card Type": selectValue(entry.card_type),
      "Current Market Price": { number: numberValue(entry.price) },
      "Last Market Date": { date: { start: entryDate } },
    }),
  });
}

async function savePriceEntry(entry) {
  requireNotionEnv();
  const recordType = (entry.record_type || "Market").toLowerCase();
  const cardTitle = buildCardTitle(entry);
  let cardPage = await findCardByTitle(cardTitle);
  if (!cardPage) {
    cardPage = await createCard(entry, cardTitle);
  }
  const pricePage = await createPriceHistory(entry, cardPage.id);
  let lotPage = null;

  if (recordType === "buy") {
    requirePortfolioEnv();
    lotPage = await createPortfolioLot(entry, cardPage.id);
  }

  // Always sync card-level snapshot with latest saved browser price.
  await updateCardMarketSnapshot(cardPage.id, entry);

  return {
    cardPageId: cardPage.id,
    pricePageId: pricePage.id,
    lotPageId: lotPage?.id || null,
  };
}

module.exports = {
  savePriceEntry,
};
