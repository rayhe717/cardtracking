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

function applyDictionary(text, rows) {
  let output = text;
  for (const row of rows) {
    const zh = row.Chinese;
    const en = row.English;
    if (!zh || !en) {
      continue;
    }
    output = output.replaceAll(zh, en);
  }
  return output;
}

function normalizeOCRText(inputText) {
  let text = inputText || "";
  text = applyDictionary(text, cardTerms);
  text = applyDictionary(text, sets);
  text = applyDictionary(text, drivers);
  text = applyDictionary(text, parallels);
  return text;
}

function getCardTypes() {
  return [...new Set(cardTerms.map((row) => row.English).filter(Boolean))];
}

module.exports = {
  normalizeOCRText,
  getCardTypes,
};
