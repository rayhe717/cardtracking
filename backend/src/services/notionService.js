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
  return [entry.set_name, entry.driver, entry.card_type].filter(Boolean).join(" ");
}

async function findCardByProperties(entry) {
  const filters = [];

  if (entry.set_name) {
    filters.push({
      property: "Set",
      select: { equals: entry.set_name },
    });
  }

  if (entry.card_type) {
    filters.push({
      property: "Card Type",
      select: { equals: entry.card_type },
    });
  }

  if (entry.driver) {
    const drivers = Array.isArray(entry.driver) ? entry.driver : [entry.driver];
    for (const driver of drivers.filter(Boolean)) {
      filters.push({
        property: "Driver",
        multi_select: { contains: driver },
      });
    }
  }

  if (filters.length === 0) {
    return null;
  }

  const res = await notion.databases.query({
    database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
    filter: filters.length === 1 ? filters[0] : { and: filters },
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
      "Price CNY": { number: numberValue(entry.price_cny) },
      Platform: selectValue(normalizePlatform(entry.platform)),
      Set: selectValue(entry.set_name),
      "Card Type": selectValue(entry.card_type),
      Driver: multiSelectValue(entry.driver),
      Parallel: selectValue(entry.parallel),
      "Serial Number": { rich_text: [{ text: { content: entry.serial_number || "" } }] },
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
      Fees: { number: numberValue(entry.fees) || 0 },
      "Price CNY": { number: numberValue(entry.price_cny) },
      Quantity: { number: numberValue(entry.quantity) || 1 },
      Driver: multiSelectValue(entry.driver),
      Parallel: selectValue(entry.parallel),
      "Serial Number": { rich_text: [{ text: { content: entry.serial_number || "" } }] },
      Status: selectValue(entry.status || "Holding"),
      Notes: { rich_text: [{ text: { content: entry.notes || "" } }] },
    }),
  });
}

async function savePriceEntry(entry) {
  requireNotionEnv();
  const recordType = (entry.record_type || "Market").toLowerCase();
  const cardTitle = buildCardTitle(entry);
  let cardPage = await findCardByProperties(entry);
  if (!cardPage) {
    cardPage = await createCard(entry, cardTitle);
  }
  const pricePage = await createPriceHistory(entry, cardPage.id);
  let lotPage = null;

  if (recordType === "buy") {
    requirePortfolioEnv();
    lotPage = await createPortfolioLot(entry, cardPage.id);
  }

  return {
    cardPageId: cardPage.id,
    pricePageId: pricePage.id,
    lotPageId: lotPage?.id || null,
  };
}

async function listCards() {
  requireNotionEnv();
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const title = props["Card ID"]?.title?.[0]?.plain_text || "";
      const set = props["Set"]?.select?.name || "";
      const driver = (props["Driver"]?.multi_select || []).map((d) => d.name).join(" / ");
      const cardType = props["Card Type"]?.select?.name || "";
      results.push({
        id: page.id,
        title,
        set,
        driver,
        cardType,
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function getPriceHistory(cardId) {
  requireNotionEnv();
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_PRICE_HISTORY_DB_ID,
      filter: {
        property: "Card",
        relation: { contains: cardId },
      },
      sorts: [{ property: "Date", direction: "ascending" }],
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      results.push({
        id: page.id,
        date: props["Date"]?.date?.start || "",
        price: props["Price"]?.number || 0,
        priceCny: props["Price CNY"]?.number || 0,
        currency: props["Currency"]?.select?.name || "USD",
        parallel: props["Parallel"]?.select?.name || "",
        serialNumber: props["Serial Number"]?.rich_text?.[0]?.plain_text || "",
        platform: props["Platform"]?.select?.name || "",
        recordType: props["Record Type"]?.select?.name || "Market",
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function getPriceHistoryFiltered({ sets, drivers, cardTypes, parallels, platforms }) {
  requireNotionEnv();

  const cardFilters = [];
  if (sets && sets.length > 0) {
    if (sets.length === 1) {
      cardFilters.push({ property: "Set", select: { equals: sets[0] } });
    } else {
      cardFilters.push({ or: sets.map((s) => ({ property: "Set", select: { equals: s } })) });
    }
  }
  if (cardTypes && cardTypes.length > 0) {
    if (cardTypes.length === 1) {
      cardFilters.push({ property: "Card Type", select: { equals: cardTypes[0] } });
    } else {
      cardFilters.push({ or: cardTypes.map((ct) => ({ property: "Card Type", select: { equals: ct } })) });
    }
  }
  if (drivers && drivers.length > 0) {
    if (drivers.length === 1) {
      cardFilters.push({ property: "Driver", multi_select: { contains: drivers[0] } });
    } else {
      cardFilters.push({ or: drivers.map((d) => ({ property: "Driver", multi_select: { contains: d } })) });
    }
  }

  let cardIds = null;
  if (cardFilters.length > 0) {
    cardIds = [];
    let cursor;
    do {
      const res = await notion.databases.query({
        database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
        filter: cardFilters.length === 1 ? cardFilters[0] : { and: cardFilters },
        start_cursor: cursor,
        page_size: 100,
      });
      for (const page of res.results) {
        cardIds.push(page.id);
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    if (cardIds.length === 0) {
      return [];
    }
  }

  const priceFilters = [];
  if (cardIds && cardIds.length > 0) {
    priceFilters.push({
      or: cardIds.map((id) => ({ property: "Card", relation: { contains: id } })),
    });
  }
  if (parallels && parallels.length > 0) {
    if (parallels.length === 1) {
      priceFilters.push({ property: "Parallel", select: { equals: parallels[0] } });
    } else {
      priceFilters.push({ or: parallels.map((p) => ({ property: "Parallel", select: { equals: p } })) });
    }
  }
  if (platforms && platforms.length > 0) {
    if (platforms.length === 1) {
      priceFilters.push({ property: "Platform", select: { equals: platforms[0] } });
    } else {
      priceFilters.push({ or: platforms.map((p) => ({ property: "Platform", select: { equals: p } })) });
    }
  }

  const results = [];
  let cursor;
  do {
    const queryParams = {
      database_id: process.env.NOTION_PRICE_HISTORY_DB_ID,
      sorts: [{ property: "Date", direction: "ascending" }],
      start_cursor: cursor,
      page_size: 100,
    };
    if (priceFilters.length > 0) {
      queryParams.filter = priceFilters.length === 1 ? priceFilters[0] : { and: priceFilters };
    }
    const res = await notion.databases.query(queryParams);
    for (const page of res.results) {
      const props = page.properties;
      const driverArr = props["Driver"]?.multi_select || [];
      results.push({
        id: page.id,
        date: props["Date"]?.date?.start || "",
        price: props["Price"]?.number || 0,
        priceCny: props["Price CNY"]?.number || 0,
        currency: props["Currency"]?.select?.name || "USD",
        parallel: props["Parallel"]?.select?.name || "",
        serialNumber: props["Serial Number"]?.rich_text?.[0]?.plain_text || "",
        platform: props["Platform"]?.select?.name || "",
        recordType: props["Record Type"]?.select?.name || "Market",
        driver: driverArr.map((d) => d.name).join(" / "),
        set: props["Set"]?.select?.name || "",
        cardType: props["Card Type"]?.select?.name || "",
      });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function getTrendFilterOptions() {
  requireNotionEnv();
  const sets = new Set();
  const drivers = new Set();
  const cardTypes = new Set();
  const parallels = new Set();
  const platforms = new Set();

  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const setName = props["Set"]?.select?.name;
      const cardType = props["Card Type"]?.select?.name;
      const driverArr = props["Driver"]?.multi_select || [];
      if (setName) sets.add(setName);
      if (cardType) cardTypes.add(cardType);
      driverArr.forEach((d) => drivers.add(d.name));
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_PRICE_HISTORY_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const parallel = props["Parallel"]?.select?.name;
      const setName = props["Set"]?.select?.name;
      const cardType = props["Card Type"]?.select?.name;
      const platform = props["Platform"]?.select?.name;
      const driverArr = props["Driver"]?.multi_select || [];
      if (parallel) parallels.add(parallel);
      if (setName) sets.add(setName);
      if (cardType) cardTypes.add(cardType);
      if (platform) platforms.add(platform);
      driverArr.forEach((d) => drivers.add(d.name));
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return {
    sets: Array.from(sets).sort(),
    drivers: Array.from(drivers).sort(),
    cardTypes: Array.from(cardTypes).sort(),
    parallels: Array.from(parallels).sort(),
    platforms: Array.from(platforms).sort(),
  };
}

async function getAvailableSets() {
  requireNotionEnv();
  const sets = new Set();

  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const setName = props["Set"]?.select?.name;
      if (setName) sets.add(setName);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return Array.from(sets).sort();
}

async function getParallelsForSet(setName) {
  requireNotionEnv();

  const cardIds = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_CARD_REGISTRY_DB_ID,
      filter: { property: "Set", select: { equals: setName } },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      cardIds.push(page.id);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  if (cardIds.length === 0) {
    return [];
  }

  const parallels = new Set();
  cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: process.env.NOTION_PRICE_HISTORY_DB_ID,
      filter: {
        or: cardIds.map((id) => ({ property: "Card", relation: { contains: id } })),
      },
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      const props = page.properties;
      const parallel = props["Parallel"]?.select?.name;
      if (parallel) parallels.add(parallel);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return Array.from(parallels).sort();
}

module.exports = {
  savePriceEntry,
  listCards,
  getPriceHistory,
  getPriceHistoryFiltered,
  getTrendFilterOptions,
};
