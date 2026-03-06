const sharp = require("sharp");

function getConfiguredBaseUrl() {
  // If PUBLIC_BASE_URL is set (even empty), respect it and ignore BACKEND_PUBLIC_URL.
  if (process.env.PUBLIC_BASE_URL !== undefined) {
    return String(process.env.PUBLIC_BASE_URL).trim();
  }
  return String(process.env.BACKEND_PUBLIC_URL || "").trim();
}

function buildImageUrl(fileName) {
  const base = getConfiguredBaseUrl().replace(/\/$/, "");
  if (base) {
    return `${base}/uploads/${fileName}`;
  }
  // Use relative path for local dev so frontend proxy serves same-origin images
  return `/uploads/${fileName}`;
}

function buildLocalImageUrl(fileName) {
  return `/uploads/${fileName}`;
}

function resolveAttachmentUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (/^https?:\/\//.test(url)) return url;
  const base = getConfiguredBaseUrl().replace(/\/$/, "");
  if (base) return `${base}${url.startsWith("/") ? url : `/${url}`}`;
  return `http://localhost:${process.env.PORT || 4000}${url.startsWith("/") ? url : `/${url}`}`;
}

async function cropImage(inputPath, outputPath, crop, target) {
  const left = Math.max(0, Math.floor(crop.x || 0));
  const top = Math.max(0, Math.floor(crop.y || 0));
  const width = Math.max(1, Math.floor(crop.width || 1));
  const height = Math.max(1, Math.floor(crop.height || 1));
  const targetWidth = Math.max(1, Math.floor(target?.width || (width >= height ? 600 : 400)));
  const targetHeight = Math.max(1, Math.floor(target?.height || (width >= height ? 400 : 600)));

  await sharp(inputPath)
    .extract({ left, top, width, height })
    .resize(targetWidth, targetHeight, {
      fit: "cover",
      position: "centre",
    })
    .png()
    .toFile(outputPath);
}

module.exports = {
  getConfiguredBaseUrl,
  cropImage,
  buildImageUrl,
  buildLocalImageUrl,
  resolveAttachmentUrl,
};
