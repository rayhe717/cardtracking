const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { cropImage, buildLocalImageUrl, resolveAttachmentUrl, getConfiguredBaseUrl } = require("../services/imageService");
const { runOCR } = require("../services/ocrService");
const { extractCardData } = require("../services/extractionService");
const { loadChecklist, matchCard } = require("../services/matchService");
const { savePriceEntry, listCards, getPriceHistory, getPriceHistoryFiltered, getTrendFilterOptions } = require("../services/notionService");
const { getSelectOptions } = require("../services/normalizationService");

const uploadDir = path.resolve(__dirname, "../../../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      cb(new Error("Unsupported file type. Use JPG, PNG, WEBP."));
      return;
    }
    cb(null, true);
  },
});

const router = express.Router();

let checklistCache = null;
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 45000);
function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function validatePublicBaseUrl(baseUrl) {
  const normalizedBase = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!normalizedBase) {
    console.warn("Warning: PUBLIC_BASE_URL not set. Images may not appear in Notion.");
    return false;
  }
  if (!/^https?:\/\//i.test(normalizedBase)) {
    console.warn("Warning: PUBLIC_BASE_URL must start with http:// or https://");
    return false;
  }
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(normalizedBase)) {
    console.warn("Warning: PUBLIC_BASE_URL should be internet-accessible (not localhost) for Notion to fetch images.");
    return false;
  }
  return true;
}

router.get("/checklist", (_req, res) => {
  if (!checklistCache) {
    checklistCache = loadChecklist();
  }
  res.json({ ok: true, checklist: checklistCache });
});

router.get("/options", (_req, res) => {
  res.json({ ok: true, options: getSelectOptions() });
});

router.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: "Image upload failed." });
    return;
  }
  const image = {
    fileName: req.file.filename,
    filePath: req.file.path,
    imageUrl: buildLocalImageUrl(req.file.filename),
  };
  res.json({ ok: true, image });
});

router.post("/crop", async (req, res) => {
  try {
    const { fileName, crop, target } = req.body;
    if (!fileName || !crop) {
      res.status(400).json({ ok: false, error: "fileName and crop are required." });
      return;
    }
    const originalPath = path.join(uploadDir, fileName);
    const croppedFileName = `${path.parse(fileName).name}-crop-${Date.now()}.png`;
    const croppedPath = path.join(uploadDir, croppedFileName);
    await cropImage(originalPath, croppedPath, crop, target);
    res.json({
      ok: true,
      cropped: {
        fileName: croppedFileName,
        filePath: croppedPath,
        imageUrl: buildLocalImageUrl(croppedFileName),
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Crop failed: ${error.message}` });
  }
});

router.post("/ocr", async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      res.status(400).json({ ok: false, error: "fileName is required." });
      return;
    }
    const filePath = path.join(uploadDir, fileName);
    const text = await withTimeout(
      runOCR(filePath),
      OCR_TIMEOUT_MS,
      "OCR timed out. Check network access or use manual OCR text."
    );
    res.json({ ok: true, text });
  } catch (error) {
    res.status(500).json({ ok: false, error: `OCR failed: ${error.message}` });
  }
});

router.post("/extract", async (req, res) => {
  try {
    const { ocrText } = req.body;
    if (!ocrText || !ocrText.trim()) {
      res.status(400).json({ ok: false, error: "ocrText is required." });
      return;
    }
    if (!checklistCache) {
      checklistCache = loadChecklist();
    }
    const extracted = await extractCardData(ocrText);
    const match = matchCard(extracted, checklistCache);
    res.json({ ok: true, extracted, match });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Extraction failed: ${error.message}` });
  }
});

router.post("/save", async (req, res) => {
  try {
    const { entry } = req.body;
    if (!entry) {
      res.status(400).json({ ok: false, error: "entry is required." });
      return;
    }
    const hasAttachments = Array.isArray(entry.attachments) && entry.attachments.some((a) => Boolean(a?.url));
    const baseUrl = getConfiguredBaseUrl();
    const urlValid = validatePublicBaseUrl(baseUrl);
    
    let attachments = entry.attachments || [];
    if (hasAttachments && urlValid) {
      attachments = attachments.map((a) => ({
        ...a,
        url: a.url ? resolveAttachmentUrl(a.url) : a.url,
      }));
    } else if (hasAttachments && !urlValid) {
      attachments = [];
    }
    
    const result = await savePriceEntry({ ...entry, attachments });
    const warning = hasAttachments && !urlValid ? "Entry saved but image skipped (PUBLIC_BASE_URL not configured properly)." : null;
    res.json({ ok: true, result, warning });
  } catch (error) {
    res.status(500).json({ ok: false, error: `Notion save failed: ${error.message}` });
  }
});

router.get("/cards", async (_req, res) => {
  try {
    const cards = await listCards();
    res.json({ ok: true, cards });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/price-history/:cardId", async (req, res) => {
  try {
    const history = await getPriceHistory(req.params.cardId);
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/price-history-filtered", async (req, res) => {
  try {
    const parseList = (val) => (val ? val.split(",").map((v) => v.trim()).filter(Boolean) : []);
    const sets = parseList(req.query.sets || req.query.set);
    const drivers = parseList(req.query.drivers || req.query.driver);
    const cardTypes = parseList(req.query.cardTypes || req.query.cardType);
    const parallels = parseList(req.query.parallels || req.query.parallel);
    const platforms = parseList(req.query.platforms || req.query.platform);
    const history = await getPriceHistoryFiltered({ sets, drivers, cardTypes, parallels, platforms });
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get("/trend-options", async (_req, res) => {
  try {
    const options = await getTrendFilterOptions();
    res.json({ ok: true, options });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

const { analyzeTrends } = require("../services/analysisService");

router.post("/analyze-trends", async (req, res) => {
  try {
    const { question, priceHistory, filters } = req.body;
    if (!question || !priceHistory) {
      return res.status(400).json({ ok: false, error: "Question and price history are required" });
    }
    const response = await analyzeTrends(question, priceHistory, filters);
    res.json({ ok: true, response });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.use((error, _req, res, _next) => {
  res.status(400).json({ ok: false, error: error.message });
});

module.exports = { router };
