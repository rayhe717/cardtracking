const Tesseract = require("tesseract.js");
const path = require("path");

const TESSDATA_DIR = path.resolve(__dirname, "../../tessdata");
const PRIMARY_LANG = process.env.OCR_LANG_PRIMARY || "eng+chi_sim+chi_tra";
const FALLBACK_LANG = process.env.OCR_LANG_FALLBACK || "eng";

const workerOptions = {
  langPath: TESSDATA_DIR,
  gzip: false,
  logger: () => {},
};

async function runOCR(filePath) {
  try {
    const worker = await Tesseract.createWorker(PRIMARY_LANG, 1, workerOptions);
    const result = await worker.recognize(filePath);
    await worker.terminate();
    return result.data.text || "";
  } catch (primaryError) {
    try {
      const worker = await Tesseract.createWorker(FALLBACK_LANG, 1, workerOptions);
      const result = await worker.recognize(filePath);
      await worker.terminate();
      return result.data.text || "";
    } catch (fallbackError) {
      throw new Error(
        `OCR failed (primary: ${PRIMARY_LANG}, fallback: ${FALLBACK_LANG}). ${primaryError.message}`
      );
    }
  }
}

module.exports = { runOCR };
