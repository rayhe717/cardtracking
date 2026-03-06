const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");

function loadChecklist() {
  const dbDir = path.resolve(__dirname, "../../../database");
  if (!fs.existsSync(dbDir)) {
    return [];
  }
  const files = fs.readdirSync(dbDir).filter((name) => name.endsWith(".json"));
  const all = [];
  for (const fileName of files) {
    const filePath = path.join(dbDir, fileName);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    all.push(content);
  }
  return all;
}

function buildCandidates(checklist) {
  const candidates = [];
  for (const setItem of checklist) {
    for (const card of setItem.cards || []) {
      candidates.push({
        set_name: setItem.set || "",
        parallel_options: setItem.parallels || [],
        card_number: card.card_number || "",
        driver: card.driver || "",
        team: card.team || "",
        searchable: `${setItem.set || ""} ${card.driver || ""} ${card.card_number || ""} ${card.team || ""}`,
      });
    }
  }
  return candidates;
}

function matchCard(extracted, checklist) {
  const candidates = buildCandidates(checklist);
  if (!candidates.length) {
    return null;
  }

  const query = [extracted.set_name, extracted.driver, extracted.card_number].filter(Boolean).join(" ");
  const fuse = new Fuse(candidates, {
    keys: ["searchable", "set_name", "driver", "card_number"],
    threshold: 0.35,
  });
  const hit = fuse.search(query)[0];
  if (!hit) {
    return null;
  }

  const matched = hit.item;
  return {
    confidence: Number((1 - hit.score).toFixed(2)),
    suggested: {
      set_name: matched.set_name,
      driver: matched.driver,
      card_number: matched.card_number,
      parallel:
        extracted.parallel && matched.parallel_options.includes(extracted.parallel)
          ? extracted.parallel
          : extracted.parallel || "",
    },
  };
}

module.exports = {
  loadChecklist,
  matchCard,
};
