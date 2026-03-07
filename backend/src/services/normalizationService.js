const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

function loadDictionary(fileName) {
  const filePath = path.resolve(__dirname, `../../../${fileName}`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const csvContent = fs.readFileSync(filePath, "utf8");
  return parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

const drivers = loadDictionary("drivers.csv");
const parallels = loadDictionary("parallels.csv");
const sets = loadDictionary("sets.csv");
const cardTerms = loadDictionary("card_terms.csv");

function removeCJKSpaces(text) {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
  } while (result !== previous);
  return result;
}

function applyDictionary(text, rows) {
  let output = text;
  for (const row of rows) {
    const zh = row.Chinese;
    const en = row.English;
    if (!zh || !en) {
      continue;
    }
    const pattern = zh.split("").join("\\s*");
    const regex = new RegExp(pattern, "g");
    output = output.replace(regex, en);
  }
  return output;
}

function normalizeOCRText(inputText) {
  let text = inputText || "";
  text = removeCJKSpaces(text);
  text = applyDictionary(text, cardTerms);
  text = applyDictionary(text, sets);
  text = applyDictionary(text, drivers);
  text = applyDictionary(text, parallels);
  return text;
}

function getCardTypes() {
  return [...new Set(cardTerms.map((row) => row.English).filter(Boolean))];
}

function getSelectOptions() {
  const sortAlpha = (arr) => [...arr].sort((a, b) => a.localeCompare(b));
  return {
    sets: sortAlpha([...new Set(sets.map((row) => row.English).filter(Boolean))]),
    drivers: sortAlpha([...new Set(drivers.map((row) => row.English).filter(Boolean))]),
    parallels: sortAlpha([...new Set(parallels.map((row) => row.English).filter(Boolean))]),
    cardTypes: sortAlpha(getCardTypes()),
    currencies: ["USD", "CNY", "HKD", "EUR", "GBP", "SGD"],
  };
}

function getDictionariesForPrompt() {
  const options = getSelectOptions();

  const chineseToEnglish = [];
  for (const row of [...cardTerms, ...sets, ...drivers, ...parallels]) {
    if (row.Chinese && row.English && row.Chinese !== row.English) {
      chineseToEnglish.push(`"${row.Chinese}" → "${row.English}"`);
    }
  }

  return {
    validSets: options.sets,
    validDrivers: options.drivers,
    validParallels: options.parallels,
    validCardTypes: options.cardTypes,
    validCurrencies: options.currencies,
    chineseTranslations: chineseToEnglish,
  };
}

module.exports = {
  normalizeOCRText,
  getCardTypes,
  getSelectOptions,
  getDictionariesForPrompt,
};
