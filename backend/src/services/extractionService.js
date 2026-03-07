const OpenAI = require("openai");
const Fuse = require("fuse.js");
const { normalizeOCRText, getCardTypes, getDictionariesForPrompt, getSelectOptions } = require("./normalizationService");

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

function buildExtractionPrompt(text) {
  const dict = getDictionariesForPrompt();

  const systemPrompt = `You are an expert at extracting F1 trading card listing details from OCR text.
Your job is to extract structured data and return ONLY a valid JSON object.

IMPORTANT RULES:
1. Use EXACT values from the valid options lists below - do not invent new values or add extra spaces
2. If a field cannot be determined, use empty string "" for text fields or null for price
3. Translate Chinese terms to English using the translations provided
4. Return strict JSON only, no markdown or explanations`;

  const userPrompt = `## VALID OPTIONS (use these exact values):

**Sets (set_name):**
${dict.validSets.join(", ")}

**Drivers (driver):**
${dict.validDrivers.join(", ")}

**Card Types (card_type):**
${dict.validCardTypes.join(", ")}

**Parallels (parallel):**
${dict.validParallels.join(", ")}

**Currencies (currency):**
${dict.validCurrencies.join(", ")}

**Platforms (platform):**
eBay, Xianyu, Katao, Carousell, Others

## CHINESE TO ENGLISH TRANSLATIONS:
${dict.chineseTranslations.slice(0, 50).join("\n")}

## FIELDS TO EXTRACT:
- set_name: Card set name (must match valid sets above)
- card_type: Insert/subset type like Autographs, Rookie, Grand Prix Winners, Pole Position, etc.
- driver: F1 driver name (must match valid drivers above)
- card_number: Card number if visible
- parallel: Card parallel/variant (must match valid parallels above)
- serial_number: Full serial numbering including both numbers, e.g. "25/99", "1/1", "50/199". Include the complete "XX/YY" format, not just "/YY"
- price: Numeric price value (no currency symbol). Prices may appear with comma separators like "1,500" or "2,000" - convert to plain number (1500, 2000)
- currency: Currency code (USD, CNY, HKD, EUR, GBP, SGD)
- platform: Selling platform
- grading_company: PSA, BGS, SGC, etc. if graded
- grade: Numeric grade if graded
- listing_date: Date in YYYY-MM-DD format if found

## OCR TEXT TO ANALYZE:
${text}

## RESPOND WITH JSON ONLY:`;

  return { systemPrompt, userPrompt };
}

async function llmExtract(text) {
  const { systemPrompt, userPrompt } = buildExtractionPrompt(text);

  const completion = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const output = completion.choices[0]?.message?.content;
  const parsed = parseJsonFromModelOutput(output);
  return { ...defaultShape, ...parsed };
}

function fuzzyMatchToValidOption(value, validOptions, threshold = 0.4) {
  if (!value || validOptions.length === 0) {
    return value;
  }
  const valueLower = String(value).toLowerCase().trim();
  for (const opt of validOptions) {
    if (opt.toLowerCase() === valueLower) {
      return opt;
    }
  }
  const fuse = new Fuse(validOptions, {
    threshold,
    includeScore: true,
  });
  const results = fuse.search(value);
  if (results.length > 0 && results[0].score <= threshold) {
    return results[0].item;
  }
  return value;
}

function normalizeExtractedValues(extracted) {
  const options = getSelectOptions();

  const normalized = { ...extracted };

  if (normalized.set_name) {
    normalized.set_name = fuzzyMatchToValidOption(normalized.set_name, options.sets);
  }

  if (normalized.driver) {
    if (Array.isArray(normalized.driver)) {
      normalized.driver = normalized.driver.map((d) =>
        fuzzyMatchToValidOption(d, options.drivers)
      );
    } else {
      normalized.driver = fuzzyMatchToValidOption(normalized.driver, options.drivers);
    }
  }

  if (normalized.card_type) {
    normalized.card_type = fuzzyMatchToValidOption(normalized.card_type, options.cardTypes);
  }

  if (normalized.parallel) {
    normalized.parallel = fuzzyMatchToValidOption(normalized.parallel, options.parallels);
  }

  if (normalized.currency) {
    normalized.currency = fuzzyMatchToValidOption(normalized.currency, options.currencies, 0.3);
  }

  return normalized;
}

async function extractCardData(rawOCRText) {
  const normalizedText = normalizeOCRText(rawOCRText);
  let extracted;
  if (!llm.client) {
    extracted = heuristicExtract(normalizedText);
  } else {
    try {
      extracted = await llmExtract(normalizedText);
    } catch (_error) {
      extracted = heuristicExtract(normalizedText);
    }
  }
  return normalizeExtractedValues(extracted);
}

module.exports = {
  extractCardData,
};
