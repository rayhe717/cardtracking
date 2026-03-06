import { useEffect, useMemo, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import "cropperjs/dist/cropper.css";

const API_BASE = "/api";
const API_TIMEOUT_MS = 45000;

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
  return "Others";
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createBlankForm() {
  return {
    record_type: "Market",
    listing_date: todayDate(),
    set_name: "",
    card_type: "",
    driver: "",
    card_number: "",
    parallel: "",
    serial_number: "",
    price: "",
    currency: "USD",
    platform: "Others",
    grading_company: "",
    grade: "",
    quantity: 1,
    fees: 0,
    status: "Holding",
    lot_id: "",
    notes: "",
  };
}

async function api(path, method = "GET", body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    }).catch((error) => {
      if (error.name === "AbortError") {
        throw new Error("Request timed out. Backend may be unreachable or OCR is stuck.");
      }
      throw error;
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export default function App() {
  const [originalImage, setOriginalImage] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);
  const [ocrText, setOcrText] = useState("");
  const [form, setForm] = useState(createBlankForm);
  const [match, setMatch] = useState(null);
  const [saveCropped, setSaveCropped] = useState(true);
  const [cropMode, setCropMode] = useState("portrait");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const cropperRef = useRef(null);

  const canProcess = useMemo(() => Boolean(croppedImage?.fileName), [croppedImage]);
  const canRunOcr = useMemo(() => Boolean(croppedImage?.fileName || originalImage?.fileName), [croppedImage, originalImage]);
  const isBuy = String(form.record_type || "Market") === "Buy";
  const cropTarget = cropMode === "portrait" ? { width: 400, height: 600 } : { width: 600, height: 400 };
  const cropAspect = cropTarget.width / cropTarget.height;

  useEffect(() => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || !originalImage) {
      return;
    }
    cropper.setAspectRatio(cropAspect);
    cropper.reset();
  }, [cropAspect, originalImage]);

  async function onUploadChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Upload failed");
      }
      setOriginalImage(data.image);
      setCroppedImage(null);
      setOcrText("");
      setForm(createBlankForm());
      setMatch(null);
      setMessage("Image uploaded. Running OCR + extract...");
      const text = await runOCRForFile(data.image.fileName);
      await runExtractionForText(text);
      setMessage("Auto OCR + extract complete. Adjust crop if needed.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runOCRForFile(fileName) {
    const res = await api("/ocr", "POST", { fileName });
    setOcrText(res.text || "");
    return res.text || "";
  }

  async function runExtractionForText(text) {
    if (!text.trim()) {
      return;
    }
    const res = await api("/extract", "POST", { ocrText: text });
    const extracted = res.extracted || {};
    setForm((prev) => ({
      ...prev,
      ...extracted,
      platform: normalizePlatform(extracted.platform || prev.platform),
      price: extracted.price ?? "",
      listing_date: extracted.listing_date || prev.listing_date || todayDate(),
    }));
    setMatch(res.match);
  }

  async function onCropConfirm() {
    if (!cropperRef.current || !originalImage) {
      return;
    }
    setLoading(true);
    setMessage("Cropping image...");
    try {
      const cropper = cropperRef.current.cropper;
      const data = cropper.getData(true);
      const res = await api("/crop", "POST", {
        fileName: originalImage.fileName,
        crop: {
          x: data.x,
          y: data.y,
          width: data.width,
          height: data.height,
        },
        target: cropTarget,
      });
      setCroppedImage(res.cropped);
      setMessage("Crop complete. Run OCR + extract when ready.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runOcrAndExtract() {
    const fileName = croppedImage?.fileName || originalImage?.fileName;
    if (!fileName) {
      setMessage("Please upload image first.");
      return;
    }
    setLoading(true);
    setMessage("Running OCR + extraction...");
    try {
      const text = await runOCRForFile(fileName);
      await runExtractionForText(text);
      setMessage("OCR + extraction complete.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runOCR() {
    const fileName = croppedImage?.fileName || originalImage?.fileName;
    if (!fileName) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await runOCRForFile(fileName);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function runExtraction() {
    if (!ocrText.trim()) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await runExtractionForText(ocrText);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function onSave() {
    setLoading(true);
    setMessage("");
    try {
      const attachments = [];
      if (saveCropped && croppedImage) {
        attachments.push({ name: "cropped", url: croppedImage.imageUrl });
      }

      await api("/save", "POST", {
        entry: {
          ...form,
          platform: normalizePlatform(form.platform),
          price: form.price ? Number(form.price) : 0,
          quantity: form.quantity ? Number(form.quantity) : 1,
          fees: form.fees ? Number(form.fees) : 0,
          attachments,
          date: form.listing_date || todayDate(),
        },
      });
      setMessage("Saved to Notion.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function onChangeField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-cream p-6 text-dark">
      <div className="mx-auto max-w-7xl space-y-4">
        <h1 className="text-2xl font-bold">F1 Trading Card Price Tracker</h1>
        <p className="text-sm text-dark/80">Screenshot → Crop → OCR → Extract → Match → Review/Edit → Save</p>

        <div className="rounded border border-dark/30 bg-creamAlt p-4">
          <label className="text-sm">Upload screenshot (JPG/PNG/WEBP)</label>
          <input
            className="mt-2 block w-full rounded border border-dark/30 bg-cream p-2"
            type="file"
            accept=".jpg,.jpeg,.png,.webp"
            onChange={onUploadChange}
            disabled={loading}
          />
        </div>

        {originalImage && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-dark/30 bg-creamAlt p-4">
              <h2 className="mb-3 font-semibold">Adjust Crop</h2>
              <div className="mb-3 flex items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="crop-mode"
                    checked={cropMode === "portrait"}
                    onChange={() => setCropMode("portrait")}
                    disabled={loading}
                  />
                  400 x 600 (portrait)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="crop-mode"
                    checked={cropMode === "landscape"}
                    onChange={() => setCropMode("landscape")}
                    disabled={loading}
                  />
                  600 x 400 (landscape)
                </label>
              </div>
              <Cropper
                key={cropMode}
                src={originalImage.imageUrl}
                style={{ height: 360, width: "100%" }}
                viewMode={1}
                aspectRatio={cropAspect}
                guides
                background={false}
                responsive
                autoCropArea={0.8}
                checkOrientation={false}
                ref={cropperRef}
              />
              <button
                type="button"
                onClick={onCropConfirm}
                disabled={loading}
                className="mt-3 rounded border border-dark/30 bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Crop Image
              </button>
            </div>

            <div className="rounded border border-dark/30 bg-creamAlt p-4">
              <h2 className="mb-3 font-semibold">Cropped Image Preview</h2>
              <div className="mb-3 space-y-2 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={saveCropped} onChange={(e) => setSaveCropped(e.target.checked)} />
                  Save cropped image to Notion
                </label>
              </div>
              {croppedImage && (
                <img
                  alt="cropped screenshot"
                  src={croppedImage.imageUrl}
                  className="max-h-56 w-full rounded object-contain"
                />
              )}
              {!croppedImage && <p className="text-xs text-dark/70">No cropped image yet.</p>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runOcrAndExtract}
            disabled={!canRunOcr || loading}
            className="rounded border border-dark/30 bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Run OCR + Extract
          </button>
          <button
            type="button"
            onClick={runOCR}
            disabled={!canRunOcr || loading}
            className="rounded border border-dark/30 bg-creamAlt px-3 py-2 text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            OCR Only
          </button>
          <button
            type="button"
            onClick={runExtraction}
            disabled={!ocrText.trim() || loading}
            className="rounded border border-dark/30 bg-creamAlt px-3 py-2 text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            Extract Only
          </button>
          <button
            type="button"
            onClick={() => setMessage("Adjust crop area, then click Crop Image.")}
            disabled={loading}
            className="rounded border border-dark/30 bg-creamAlt px-3 py-2 text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            Adjust crop
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <h2 className="mb-3 font-semibold">Editable Card Data</h2>
            <div className="grid grid-cols-1 gap-3 text-sm">
              {Object.entries(
                isBuy
                  ? {
                      record_type: "Record Type",
                      listing_date: "Date",
                      set_name: "Set",
                      driver: "Driver",
                      card_type: "Card Type",
                      card_number: "Card Number",
                      parallel: "Parallel",
                      serial_number: "Serial Number",
                      price: "Price",
                      currency: "Currency",
                      platform: "Platform",
                      grading_company: "Grading Company",
                      grade: "Grade",
                      quantity: "Quantity (buy)",
                      fees: "Fees (buy)",
                      status: "Status (buy)",
                      lot_id: "Lot ID (optional)",
                      notes: "Notes",
                    }
                  : {
                      record_type: "Record Type",
                      listing_date: "Date",
                      set_name: "Set",
                      driver: "Driver",
                      card_type: "Card Type",
                      card_number: "Card Number",
                      parallel: "Parallel",
                      serial_number: "Serial Number",
                      price: "Price",
                      currency: "Currency",
                      platform: "Platform",
                      grading_company: "Grading Company",
                      grade: "Grade",
                      notes: "Notes",
                    }
              ).map(([key, label]) => (
                <label key={key} className="grid gap-1">
                  <span>{label}</span>
                  {key === "record_type" ? (
                    <select
                      value={form[key] ?? "Market"}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option>Market</option>
                      <option>Buy</option>
                    </select>
                  ) : key === "listing_date" ? (
                    <input
                      type="date"
                      value={form[key] ?? todayDate()}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    />
                  ) : key === "status" ? (
                    <select
                      value={form[key] ?? "Holding"}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option>Holding</option>
                      <option>OTW</option>
                      <option>Sold</option>
                    </select>
                  ) : key === "platform" ? (
                    <select
                      value={form[key] ?? "Others"}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option>eBay</option>
                      <option>Xianyu</option>
                      <option>Katao</option>
                      <option>Carousell</option>
                      <option>Others</option>
                    </select>
                  ) : (
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    />
                  )}
                </label>
              ))}
            </div>
            {match?.suggested && (
              <p className="mt-3 text-xs text-dark/90">
                Match suggestion ({Math.round((match.confidence || 0) * 100)}%): {match.suggested.set_name} |{" "}
                {match.suggested.driver} #{match.suggested.card_number}
              </p>
            )}
          </div>

          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <h2 className="mb-3 font-semibold">Raw OCR Text</h2>
            <textarea
              className="h-[420px] w-full rounded border border-dark/30 bg-cream p-2 text-sm"
              value={ocrText}
              onChange={(e) => setOcrText(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setOriginalImage(null);
              setCroppedImage(null);
              setOcrText("");
              setForm(createBlankForm());
              setMatch(null);
              setMessage("");
            }}
            disabled={loading}
            className="rounded border border-dark/30 bg-creamAlt px-3 py-2 text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading}
            className="rounded border border-dark/30 bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save Entry
          </button>
        </div>

        {message && <p className="text-sm text-dark/90">{message}</p>}
      </div>
    </div>
  );
}
