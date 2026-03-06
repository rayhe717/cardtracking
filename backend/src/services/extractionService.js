const OpenAI = require("openai");
const { normalizeOCRText, getCardTypes } = require("./normalizationService");

function resolveProvider() {
  if (process.env.LLM_PROVIDER) {
    return process.env.LLM_PROVIDER.toLowerCase();
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return "deepseek";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "none";
}

function buildClient() {
  const provider = resolveProvider();
  if (provider === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    return {
      provider,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      client: new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      }),
    };
  }
  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL || undefined,
      }),
    };
  }
  return { provider: "none", model: "", client: null };
}

const llm = buildClient();
const knownCardTypes = getCardTypes().sort((a, b) => b.length - a.length);

const defaultShape = {
  set_name: "",
  card_type: "",
  driver: "",
  card_number: "",
  parallel: "",
  serial_number: "",
  price: null,
  currency: "",
  platform: "",
  grading_company: "",
  grade: "",
  listing_date: "",
};

function parseDate(text) {
  const patterns = [
    /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/,
    /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/,
    /(\d{1,2})[-\/](\d{1,2})[-\/](\d{2})/,
    /(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/i,
    /(\d{1,2})\s+(\w{3,9})\s+(\d{4})/i,
  ];
  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let year, month, day;
      if (/^\d{4}$/.test(match[1])) {
        [, year, month, day] = match;
      } else if (/^\d{4}$/.test(match[3])) {
        if (/^\d+$/.test(match[1])) {
          [, month, day, year] = match;
        } else {
          const m = months[match[1].toLowerCase()];
          if (m) {
            month = m;
            day = match[2];
            year = match[3];
          }
        }
      } else if (/^\d{2}$/.test(match[3])) {
        [, month, day, year] = match;
        year = Number(year) > 50 ? `19${year}` : `20${year}`;
      }
      if (/^\w+$/.test(match[2]) && months[match[2].toLowerCase()]) {
        month = months[match[2].toLowerCase()];
        day = match[1];
        year = match[3];
      }
      if (year && month && day) {
        const y = Number(year);
        const m = Number(month);
        const d = Number(day);
        if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        }
      }
    }
  }
  return "";
}

function detectCardType(lines) {
  for (const line of lines) {
    const normalizedLine = String(line || "").toLowerCase();
    for (const cardType of knownCardTypes) {
      if (normalizedLine.includes(cardType.toLowerCase())) {
        return cardType;
      }
    }
  }
  return "";
}

function heuristicExtract(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const priceRegex = /(?:USD|US\$|\$|CNY|RMB|¥|HKD)?\s?(\d+(?:\.\d+)?)/i;
  const serialRegex = /(1\/1|\/\d{1,4})/i;

  let price = null;
  let currency = "";
  let serial = "";
  let platform = "";
  let listing_date = "";

  for (const line of lines) {
    if (!serial) {
      const serialMatch = line.match(serialRegex);
      if (serialMatch) {
        serial = serialMatch[1];
      }
    }
    if (price === null) {
      const priceMatch = line.match(priceRegex);
      if (priceMatch && /price|sold|usd|rmb|hkd|\$|¥/i.test(line)) {
        price = Number(priceMatch[1]);
        if (/rmb|cny|¥/i.test(line)) {
          currency = "CNY";
        } else if (/hkd/i.test(line)) {
          currency = "HKD";
        } else {
          currency = "USD";
        }
      }
    }
    if (!platform) {
      if (/ebay/i.test(line)) {
        platform = "eBay";
      } else if (/xianyu|闲鱼/i.test(line)) {
        platform = "Xianyu";
      } else if (/katao|taobao|淘宝/i.test(line)) {
        platform = "Katao";
      } else if (/carousell/i.test(line)) {
        platform = "Carousell";
      }
    }
    if (!listing_date) {
      listing_date = parseDate(line);
    }
  }

  return {
    ...defaultShape,
    set_name: lines.find((line) => /topps|chrome|formula|f1/i.test(line)) || "",
    card_type: detectCardType(lines),
    driver: lines.find((line) => /^[A-Za-z .'-]{4,}$/.test(line)) || "",
    parallel: lines.find((line) => /refractor|raywave|checker|superfractor|parallel/i.test(line)) || "",
    serial_number: serial,
    price,
    currency,
    platform: platform || "",
    listing_date,
  };
}

function parseJsonFromModelOutput(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    throw new Error("LLM returned empty response");
  }
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("LLM returned non-JSON output");
  }
}

async function llmExtract(text) {
  const completion = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "Extract F1 trading card listing details. Normalize Chinese to English and return only JSON object.",
      },
      {
        role: "user",
        content:
          "Extract fields: set_name, card_type, driver, card_number, parallel, serial_number, price, currency, platform, grading_company, grade, listing_date.\n" +
          "Use card_type for inserts, subsets, autograph/rookie style categories such as Autographs, Rookie, Grand Prix Winners, Pole Position, Duo Cards, On The Move, Ace of Trades, Speed Demons, Helmet Collection.\n" +
          "listing_date should be in YYYY-MM-DD format if found (e.g. 2024-03-15). Look for dates indicating when the listing was posted or sold.\n" +
          "Return strict JSON only with those keys.\n\n" +
          `OCR text:\n${text}`,
      },
    ],
  });

  const output = completion.choices[0]?.message?.content;
  const parsed = parseJsonFromModelOutput(output);
  return { ...defaultShape, ...parsed };
}

async function extractCardData(rawOCRText) {
  const normalizedText = normalizeOCRText(rawOCRText);
  if (!llm.client) {
    return heuristicExtract(normalizedText);
  }
  try {
    return await llmExtract(normalizedText);
  } catch (_error) {
    return heuristicExtract(normalizedText);
  }
}

module.exports = {
  extractCardData,
};
