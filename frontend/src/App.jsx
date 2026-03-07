import { useEffect, useMemo, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import "cropperjs/dist/cropper.css";
import Trends from "./Trends";

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

const DEFAULT_CNY_RATES = {
  CNY: 1,
  USD: 7.2,
  EUR: 7.8,
  GBP: 9.1,
  HKD: 0.92,
  SGD: 5.3,
};

const RATES_STORAGE_KEY = "f1card_exchange_rates";

function loadSavedRates() {
  try {
    const saved = localStorage.getItem(RATES_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CNY_RATES, ...parsed };
    }
  } catch (e) {
    console.warn("Failed to load saved rates:", e);
  }
  return DEFAULT_CNY_RATES;
}

function saveRatesToStorage(rates) {
  try {
    localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(rates));
  } catch (e) {
    console.warn("Failed to save rates:", e);
  }
}

function convertToCNY(amount, currency, rates) {
  const rate = rates[currency] || DEFAULT_CNY_RATES[currency] || 1;
  return Math.round(amount * rate * 100) / 100;
}

function createBlankForm() {
  return {
    record_type: "Market",
    listing_date: todayDate(),
    set_name: "",
    card_type: "",
    driver: [],
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
  const [activeTab, setActiveTab] = useState("extract");
  const [exchangeRates, setExchangeRates] = useState(loadSavedRates);

  function updateRates(newRates) {
    setExchangeRates(newRates);
    saveRatesToStorage(newRates);
  }

  if (activeTab === "trends") {
    return (
      <div>
        <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
        <Trends />
      </div>
    );
  }

  if (activeTab === "settings") {
    return (
      <div>
        <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
        <SettingsView exchangeRates={exchangeRates} updateRates={updateRates} />
      </div>
    );
  }

  return (
    <div>
      <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
      <ExtractView exchangeRates={exchangeRates} />
    </div>
  );
}

function TabNav({ activeTab, setActiveTab }) {
  return (
    <div className="border-b border-dark/30 bg-creamAlt">
      <div className="mx-auto flex max-w-7xl">
        <button
          type="button"
          onClick={() => setActiveTab("extract")}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "extract"
              ? "border-b-2 border-accent bg-cream text-accent"
              : "text-dark/70 hover:bg-cream hover:text-dark"
          }`}
        >
          Extract
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("trends")}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "trends"
              ? "border-b-2 border-accent bg-cream text-accent"
              : "text-dark/70 hover:bg-cream hover:text-dark"
          }`}
        >
          Trends
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          className={`px-6 py-3 text-sm font-medium transition-colors ${
            activeTab === "settings"
              ? "border-b-2 border-accent bg-cream text-accent"
              : "text-dark/70 hover:bg-cream hover:text-dark"
          }`}
        >
          Settings
        </button>
      </div>
    </div>
  );
}

function ExtractView({ exchangeRates }) {
  const [originalImage, setOriginalImage] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);
  const [ocrText, setOcrText] = useState("");
  const [form, setForm] = useState(createBlankForm);
  const [match, setMatch] = useState(null);
  const [saveCropped, setSaveCropped] = useState(true);
  const [cropMode, setCropMode] = useState("portrait");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState({
    sets: [],
    drivers: [],
    parallels: [],
    cardTypes: [],
    currencies: ["USD", "CNY", "HKD", "EUR", "GBP", "SGD"],
  });
  const [folderImages, setFolderImages] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const cropperRef = useRef(null);

  const canProcess = useMemo(() => Boolean(croppedImage?.fileName), [croppedImage]);
  const canRunOcr = useMemo(() => Boolean(croppedImage?.fileName || originalImage?.fileName), [croppedImage, originalImage]);
  const isBuy = String(form.record_type || "Market") === "Buy";
  const cropTarget = cropMode === "portrait" ? { width: 400, height: 600 } : { width: 600, height: 400 };
  const cropAspect = cropTarget.width / cropTarget.height;

  const calculatedPriceCny = useMemo(() => {
    const price = form.price ? Number(form.price) : 0;
    const fees = form.fees ? Number(form.fees) : 0;
    const priceForConversion = isBuy ? price + fees : price;
    return convertToCNY(priceForConversion, form.currency || "USD", exchangeRates);
  }, [form.price, form.fees, form.currency, isBuy, exchangeRates]);

  useEffect(() => {
    api("/options")
      .then((data) => {
        if (data.options) {
          setOptions(data.options);
        }
      })
      .catch(() => {});
  }, []);

  async function onSelectFolder() {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const images = [];
      const allowedExts = [".jpg", ".jpeg", ".png", ".webp"];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === "file") {
          const name = entry.name.toLowerCase();
          if (allowedExts.some((ext) => name.endsWith(ext))) {
            const file = await entry.getFile();
            const url = URL.createObjectURL(file);
            images.push({ name: entry.name, file, url });
          }
        }
      }
      images.sort((a, b) => a.name.localeCompare(b.name));
      setFolderImages(images);
      setFolderName(dirHandle.name);
      setShowFolderBrowser(true);
      setMessage(`Found ${images.length} images in "${dirHandle.name}"`);
    } catch (error) {
      if (error.name !== "AbortError") {
        setMessage(error.message);
      }
    }
  }

  async function onSelectFolderImage(img) {
    setLoading(true);
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("image", img.file, img.name);
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
      setMessage(`"${img.name}" uploaded. Running OCR + extract...`);
      const text = await runOCRForFile(data.image.fileName);
      await runExtractionForText(text);
      setMessage("Auto OCR + extract complete. Adjust crop if needed.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

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
    const extractedDriver = extracted.driver || "";
    const driverArray = extractedDriver ? [extractedDriver] : [];
    setForm((prev) => ({
      ...prev,
      ...extracted,
      driver: driverArray,
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

      const price = form.price ? Number(form.price) : 0;
      const fees = form.fees ? Number(form.fees) : 0;
      const currency = form.currency || "USD";
      const isBuyRecord = form.record_type === "Buy";
      const priceForConversion = isBuyRecord ? price + fees : price;
      const priceCny = convertToCNY(priceForConversion, currency, exchangeRates);

      await api("/save", "POST", {
        entry: {
          ...form,
          driver: Array.isArray(form.driver) ? form.driver : [form.driver].filter(Boolean),
          platform: normalizePlatform(form.platform),
          price,
          quantity: form.quantity ? Number(form.quantity) : 1,
          fees,
          price_cny: priceCny,
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
          <label className="mb-2 block text-sm">Upload screenshot (JPG/PNG/WEBP)</label>
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={`inline-flex h-[40px] cursor-pointer items-center justify-center rounded border border-dark/30 bg-accent px-4 text-sm font-medium text-white hover:opacity-90 ${loading ? "pointer-events-none opacity-50" : ""}`}
            >
              Select File
              <input
                className="hidden"
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={onUploadChange}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              onClick={onSelectFolder}
              disabled={loading}
              className="inline-flex h-[40px] items-center justify-center rounded border border-dark/30 bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Browse Folder
            </button>
            <button
              type="button"
              onClick={() => {
                setOriginalImage(null);
                setCroppedImage(null);
                setOcrText("");
                setForm(createBlankForm());
                setMatch(null);
                setMessage("");
                setShowFolderBrowser(false);
              }}
              disabled={loading}
              className="inline-flex h-[40px] items-center justify-center rounded border border-dark/30 bg-creamAlt px-4 text-sm font-medium text-dark hover:bg-cream disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {showFolderBrowser && folderImages.length > 0 && (
          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">
                {folderName} ({folderImages.length} images)
              </h2>
              <button
                type="button"
                onClick={() => setShowFolderBrowser(false)}
                className="rounded border border-dark/30 bg-cream px-2 py-1 text-xs hover:bg-creamAlt"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {folderImages.map((img) => (
                <button
                  key={img.name}
                  type="button"
                  onClick={() => onSelectFolderImage(img)}
                  disabled={loading}
                  className="group relative overflow-hidden rounded border border-dark/30 bg-cream hover:border-accent disabled:opacity-50"
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    className="aspect-[2/3] w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-dark/70 px-1 py-0.5 text-[10px] text-white">
                    {img.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

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
                  ) : key === "set_name" ? (
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option value="">-- Select Set --</option>
                      {options.sets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : key === "driver" ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        {(Array.isArray(form[key]) ? form[key] : []).map((d, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white"
                          >
                            {d}
                            <button
                              type="button"
                              onClick={() => {
                                const newDrivers = form[key].filter((_, i) => i !== idx);
                                onChangeField(key, newDrivers);
                              }}
                              className="ml-1 hover:text-cream"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <select
                        value=""
                        onChange={(e) => {
                          const selected = e.target.value;
                          if (!selected) return;
                          const current = Array.isArray(form[key]) ? form[key] : [];
                          if (current.length >= 2) {
                            return;
                          }
                          if (!current.includes(selected)) {
                            onChangeField(key, [...current, selected]);
                          }
                        }}
                        disabled={(Array.isArray(form[key]) ? form[key] : []).length >= 2}
                        className="rounded border border-dark/30 bg-cream p-2 disabled:opacity-50"
                      >
                        <option value="">
                          {(Array.isArray(form[key]) ? form[key] : []).length >= 2
                            ? "Max 2 drivers selected"
                            : "-- Add Driver --"}
                        </option>
                        {options.drivers
                          .filter((d) => !(Array.isArray(form[key]) ? form[key] : []).includes(d))
                          .map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                      </select>
                    </div>
                  ) : key === "card_type" ? (
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option value="">-- Select Card Type --</option>
                      {options.cardTypes.map((ct) => (
                        <option key={ct} value={ct}>
                          {ct}
                        </option>
                      ))}
                    </select>
                  ) : key === "parallel" ? (
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      <option value="">-- Select Parallel --</option>
                      {options.parallels.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : key === "currency" ? (
                    <select
                      value={form[key] ?? "USD"}
                      onChange={(e) => onChangeField(key, e.target.value)}
                      className="rounded border border-dark/30 bg-cream p-2"
                    >
                      {options.currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
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
            <div className="mt-3 rounded border border-accent/50 bg-accent/10 p-2">
              <p className="text-sm font-medium">
                Price (CNY): <span className="text-accent">{calculatedPriceCny.toFixed(2)}</span>
                {isBuy && <span className="ml-2 text-xs text-dark/70">(includes fees)</span>}
              </p>
              <p className="mt-1 text-xs text-dark/60">
                Rate: 1 {form.currency || "USD"} = {(exchangeRates[form.currency || "USD"] || 1).toFixed(4)} CNY
                <span className="ml-1">(from Settings)</span>
              </p>
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

function SettingsView({ exchangeRates, updateRates }) {
  const [rates, setRates] = useState(exchangeRates);
  const [saved, setSaved] = useState(false);

  const currencies = ["USD", "EUR", "GBP", "HKD", "SGD"];

  function onRateChange(currency, value) {
    const numValue = parseFloat(value) || 0;
    setRates((prev) => ({ ...prev, [currency]: numValue }));
    setSaved(false);
  }

  function onSave() {
    updateRates(rates);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function onReset() {
    setRates(DEFAULT_CNY_RATES);
    setSaved(false);
  }

  return (
    <div className="min-h-screen bg-cream p-6 text-dark">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <div className="rounded border border-dark/30 bg-creamAlt p-6">
          <h2 className="mb-4 text-lg font-semibold">Exchange Rates (to CNY)</h2>
          <p className="mb-4 text-sm text-dark/70">
            Enter the exchange rate for each currency to CNY. These rates will be saved and used for price conversions.
          </p>

          <div className="space-y-3">
            {currencies.map((currency) => (
              <label key={currency} className="flex items-center gap-4">
                <span className="w-16 font-medium">{currency}</span>
                <span className="text-dark/60">1 {currency} =</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={rates[currency] || ""}
                  onChange={(e) => onRateChange(currency, e.target.value)}
                  className="w-32 rounded border border-dark/30 bg-cream p-2 text-right"
                />
                <span className="text-dark/60">CNY</span>
              </label>
            ))}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onSave}
              className="rounded border border-dark/30 bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Save Rates
            </button>
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-dark/30 bg-creamAlt px-4 py-2 text-sm font-medium hover:bg-cream"
            >
              Reset to Default
            </button>
          </div>

          {saved && <p className="mt-3 text-sm text-green-600">Rates saved successfully!</p>}
        </div>

        <div className="rounded border border-dark/30 bg-creamAlt p-6">
          <h2 className="mb-3 text-lg font-semibold">Current Rates Summary</h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {currencies.map((currency) => (
              <div key={currency} className="rounded bg-cream p-2">
                <span className="font-medium">{currency}:</span>{" "}
                <span className="text-accent">{(rates[currency] || 0).toFixed(4)}</span>
              </div>
            ))}
            <div className="rounded bg-cream p-2">
              <span className="font-medium">CNY:</span> <span className="text-accent">1.0000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
