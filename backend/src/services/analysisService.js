const OpenAI = require("openai");

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

function formatPriceData(priceHistory) {
  if (!priceHistory || priceHistory.length === 0) {
    return "No price data available.";
  }

  const lines = priceHistory.map((ph) => {
    const parts = [
      ph.date,
      ph.driver || "Unknown Driver",
      ph.parallel || "Base",
      ph.serialNumber ? `#${ph.serialNumber}` : "",
      `¥${ph.priceCny?.toFixed(2) || "N/A"}`,
      ph.platform || "",
      ph.recordType === "Buy" ? "(Purchased)" : "(Market)",
    ];
    return parts.filter(Boolean).join(" | ");
  });

  return lines.join("\n");
}

function buildAnalysisPrompt(question, priceHistory, filters) {
  const filterSummary = [];
  if (filters?.sets?.length) filterSummary.push(`Sets: ${filters.sets.join(", ")}`);
  if (filters?.drivers?.length) filterSummary.push(`Drivers: ${filters.drivers.join(", ")}`);
  if (filters?.cardTypes?.length) filterSummary.push(`Card Types: ${filters.cardTypes.join(", ")}`);
  if (filters?.parallels?.length) filterSummary.push(`Parallels: ${filters.parallels.join(", ")}`);
  if (filters?.platforms?.length) filterSummary.push(`Platforms: ${filters.platforms.join(", ")}`);

  const systemPrompt = `You are an expert F1 trading card market analyst. You help collectors understand price trends, make buying/selling decisions, and identify good deals.

Your analysis should be:
- Concise and actionable
- Based on the actual data provided
- Honest about limitations (small sample size, etc.)
- Consider factors like serial numbers, parallels, and market conditions

Respond in a friendly, helpful tone. Use bullet points for clarity when appropriate.`;

  const userPrompt = `## Current Filters
${filterSummary.length > 0 ? filterSummary.join("\n") : "No specific filters applied"}

## Price History Data (${priceHistory.length} entries)
Date | Driver | Parallel | Serial | Price CNY | Platform | Type
${formatPriceData(priceHistory)}

## User Question
${question}

Please analyze the data and answer the question.`;

  return { systemPrompt, userPrompt };
}

async function analyzeTrends(question, priceHistory, filters) {
  if (!llm.client) {
    throw new Error("No LLM provider configured. Set DEEPSEEK_API_KEY or OPENAI_API_KEY in .env");
  }

  const { systemPrompt, userPrompt } = buildAnalysisPrompt(question, priceHistory, filters);

  const completion = await llm.client.chat.completions.create({
    model: llm.model,
    temperature: 0.7,
    max_tokens: 1000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  return completion.choices[0]?.message?.content || "No response from AI.";
}

module.exports = {
  analyzeTrends,
};
