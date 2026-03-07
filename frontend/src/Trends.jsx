import { useEffect, useState, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar, Scatter } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

const API_BASE = "/api";

const COLORS = [
  "#FA8112",
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ca8a04",
  "#be185d",
  "#4f46e5",
  "#059669",
];

const CHART_TYPES = [
  { id: "line", label: "Line" },
  { id: "bar", label: "Bar" },
  { id: "scatter", label: "Scatter" },
];

const GROUP_BY_OPTIONS = [
  { id: "parallel", label: "Parallel" },
  { id: "driver", label: "Driver" },
  { id: "set", label: "Set" },
  { id: "cardType", label: "Card Type" },
  { id: "platform", label: "Platform" },
];

function MultiSelectFilter({ label, options, selected, onToggle, disabled }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <label className="block text-xs text-dark/70">{label}</label>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="mt-1 w-full rounded border border-dark/30 bg-cream p-2 text-left text-sm disabled:opacity-50"
      >
        {selected.length === 0 ? (
          <span className="text-dark/50">-- Any --</span>
        ) : (
          <span className="text-dark">{selected.length} selected</span>
        )}
      </button>
      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-white"
            >
              {v.length > 15 ? v.slice(0, 15) + "..." : v}
              <button type="button" onClick={() => onToggle(v)} className="hover:text-cream">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded border border-dark/30 bg-cream shadow-lg">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onToggle(opt)}
                className={`w-full px-2 py-1.5 text-left text-xs hover:bg-creamAlt ${
                  selected.includes(opt) ? "bg-accent/20 font-medium" : ""
                }`}
              >
                {selected.includes(opt) && <span className="mr-1">✓</span>}
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Trends() {
  const [priceHistory, setPriceHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chartType, setChartType] = useState("line");
  const [groupBy, setGroupBy] = useState("parallel");

  const [filterOptions, setFilterOptions] = useState({
    sets: [],
    drivers: [],
    cardTypes: [],
    parallels: [],
    platforms: [],
  });
  const [selectedSets, setSelectedSets] = useState([]);
  const [selectedDrivers, setSelectedDrivers] = useState([]);
  const [selectedCardTypes, setSelectedCardTypes] = useState([]);
  const [selectedParallels, setSelectedParallels] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);

  const hasAnyFilter = selectedSets.length > 0 || selectedDrivers.length > 0 || selectedCardTypes.length > 0 || selectedParallels.length > 0 || selectedPlatforms.length > 0;

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/trend-options`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setFilterOptions(data.options || { sets: [], drivers: [], cardTypes: [], parallels: [], platforms: [] });
        } else {
          setError(data.error || "Failed to load filter options");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!hasAnyFilter) {
      setPriceHistory([]);
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (selectedSets.length) params.set("sets", selectedSets.join(","));
    if (selectedDrivers.length) params.set("drivers", selectedDrivers.join(","));
    if (selectedCardTypes.length) params.set("cardTypes", selectedCardTypes.join(","));
    if (selectedParallels.length) params.set("parallels", selectedParallels.join(","));
    if (selectedPlatforms.length) params.set("platforms", selectedPlatforms.join(","));

    fetch(`${API_BASE}/price-history-filtered?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setPriceHistory(data.history || []);
        } else {
          setError(data.error || "Failed to load price history");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedSets, selectedDrivers, selectedCardTypes, selectedParallels, selectedPlatforms, hasAnyFilter]);

  const chartData = useMemo(() => {
    if (!priceHistory.length) return null;

    const byGroup = {};
    priceHistory.forEach((ph) => {
      const key = ph[groupBy] || `(No ${GROUP_BY_OPTIONS.find((g) => g.id === groupBy)?.label || groupBy})`;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(ph);
    });

    const allDates = [...new Set(priceHistory.map((ph) => ph.date))].sort();

    if (chartType === "scatter") {
      const datasets = Object.entries(byGroup).map(([groupName, entries], idx) => {
        const isBuyArray = entries.map((e) => e.recordType === "Buy");
        return {
          label: groupName,
          data: entries.map((e) => ({
            x: allDates.indexOf(e.date),
            y: e.priceCny,
          })),
          borderColor: COLORS[idx % COLORS.length],
          backgroundColor: COLORS[idx % COLORS.length] + "99",
          pointRadius: isBuyArray.map((isBuy) => (isBuy ? 8 : 6)),
          pointHoverRadius: 10,
          pointStyle: isBuyArray.map((isBuy) => (isBuy ? "rectRot" : "circle")),
        };
      });
      return { labels: allDates, datasets };
    }

    const datasets = Object.entries(byGroup).map(([groupName, entries], idx) => {
      const datePrices = {};
      const dateRecordType = {};
      entries.forEach((e) => {
        if (!datePrices[e.date]) {
          datePrices[e.date] = [];
        }
        datePrices[e.date].push(e.priceCny);
        if (e.recordType === "Buy") {
          dateRecordType[e.date] = "Buy";
        } else if (!dateRecordType[e.date]) {
          dateRecordType[e.date] = e.recordType;
        }
      });
      const dateMap = {};
      Object.keys(datePrices).forEach((date) => {
        const prices = datePrices[date].sort((a, b) => a - b);
        const mid = Math.floor(prices.length / 2);
        dateMap[date] = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      });
      const pointStyles = allDates.map((d) => (dateRecordType[d] === "Buy" ? "rectRot" : "circle"));
      const pointRadii = allDates.map((d) => (dateRecordType[d] === "Buy" ? 6 : 4));
      return {
        label: groupName,
        data: allDates.map((d) => dateMap[d] ?? null),
        borderColor: COLORS[idx % COLORS.length],
        backgroundColor: COLORS[idx % COLORS.length] + (chartType === "bar" ? "99" : "33"),
        tension: 0.3,
        spanGaps: true,
        pointStyle: pointStyles,
        pointRadius: pointRadii,
        pointHoverRadius: 8,
      };
    });

    return {
      labels: allDates,
      datasets,
    };
  }, [priceHistory, chartType, groupBy]);

  const allDates = useMemo(() => [...new Set(priceHistory.map((ph) => ph.date))].sort(), [priceHistory]);

  const chartOptions = useMemo(() => {
    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
        },
        title: {
          display: true,
          text: "Price CNY Over Time",
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (chartType === "scatter") {
                const dateLabel = allDates[ctx.parsed.x] || "";
                return `${ctx.dataset.label}: ¥${ctx.parsed.y?.toFixed(2) || "N/A"} (${dateLabel})`;
              }
              return `${ctx.dataset.label}: ¥${ctx.parsed.y?.toFixed(2) || "N/A"}`;
            },
          },
        },
      },
      scales: {
        y: {
          title: {
            display: true,
            text: "Price (CNY)",
          },
          beginAtZero: false,
        },
        x: {
          title: {
            display: true,
            text: "Date",
          },
        },
      },
    };

    if (chartType === "scatter") {
      baseOptions.scales.x = {
        type: "linear",
        title: {
          display: true,
          text: "Date",
        },
        ticks: {
          callback: (value) => allDates[value] || "",
        },
      };
    }

    return baseOptions;
  }, [chartType, allDates]);

  function clearFilters() {
    setSelectedSets([]);
    setSelectedDrivers([]);
    setSelectedCardTypes([]);
    setSelectedParallels([]);
    setSelectedPlatforms([]);
    setPriceHistory([]);
  }

  function toggleFilter(setter, current, value) {
    if (current.includes(value)) {
      setter(current.filter((v) => v !== value));
    } else {
      setter([...current, value]);
    }
  }

  const activeFilters = [
    selectedSets.length > 0 ? `Set: ${selectedSets.join(", ")}` : null,
    selectedDrivers.length > 0 ? `Driver: ${selectedDrivers.join(", ")}` : null,
    selectedCardTypes.length > 0 ? `Card Type: ${selectedCardTypes.join(", ")}` : null,
    selectedParallels.length > 0 ? `Parallel: ${selectedParallels.join(", ")}` : null,
    selectedPlatforms.length > 0 ? `Platform: ${selectedPlatforms.join(", ")}` : null,
  ].filter(Boolean);

  const disabledGroupBy = {
    set: selectedSets.length === 1,
    driver: selectedDrivers.length === 1,
    cardType: selectedCardTypes.length === 1,
    parallel: selectedParallels.length === 1,
    platform: selectedPlatforms.length === 1,
  };

  const availableGroupByOptions = GROUP_BY_OPTIONS.filter((g) => !disabledGroupBy[g.id]);

  useEffect(() => {
    if (disabledGroupBy[groupBy] && availableGroupByOptions.length > 0) {
      setGroupBy(availableGroupByOptions[0].id);
    }
  }, [selectedSets, selectedDrivers, selectedCardTypes, selectedParallels, selectedPlatforms]);

  return (
    <div className="min-h-screen bg-cream p-6 text-dark">
      <div className="mx-auto max-w-7xl space-y-4">
        <h1 className="text-2xl font-bold">Price Trends</h1>
        <p className="text-sm text-dark/80">Filter by any combination and group by your choice</p>

        <div className="rounded border border-dark/30 bg-creamAlt p-4">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">Filters (click to select multiple)</label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <MultiSelectFilter
                label="Set"
                options={filterOptions.sets}
                selected={selectedSets}
                onToggle={(v) => toggleFilter(setSelectedSets, selectedSets, v)}
                disabled={loading}
              />
              <MultiSelectFilter
                label="Driver"
                options={filterOptions.drivers}
                selected={selectedDrivers}
                onToggle={(v) => toggleFilter(setSelectedDrivers, selectedDrivers, v)}
                disabled={loading}
              />
              <MultiSelectFilter
                label="Card Type"
                options={filterOptions.cardTypes}
                selected={selectedCardTypes}
                onToggle={(v) => toggleFilter(setSelectedCardTypes, selectedCardTypes, v)}
                disabled={loading}
              />
              <MultiSelectFilter
                label="Parallel"
                options={filterOptions.parallels}
                selected={selectedParallels}
                onToggle={(v) => toggleFilter(setSelectedParallels, selectedParallels, v)}
                disabled={loading}
              />
              <MultiSelectFilter
                label="Platform"
                options={filterOptions.platforms}
                selected={selectedPlatforms}
                onToggle={(v) => toggleFilter(setSelectedPlatforms, selectedPlatforms, v)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 border-t border-dark/20 pt-4">
            <div>
              <label className="block text-sm font-medium">Group By</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {GROUP_BY_OPTIONS.map((g) => {
                  const isDisabled = disabledGroupBy[g.id];
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => !isDisabled && setGroupBy(g.id)}
                      disabled={isDisabled}
                      className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
                        isDisabled
                          ? "cursor-not-allowed border-dark/10 bg-dark/5 text-dark/30"
                          : groupBy === g.id
                            ? "border-accent bg-accent text-white"
                            : "border-dark/30 bg-cream text-dark hover:bg-creamAlt"
                      }`}
                      title={isDisabled ? `Cannot group by ${g.label} when it's filtered` : ""}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Chart Type</label>
              <div className="mt-1 flex gap-2">
                {CHART_TYPES.map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => setChartType(ct.id)}
                    className={`rounded border px-3 py-1.5 text-sm font-medium transition-colors ${
                      chartType === ct.id
                        ? "border-accent bg-accent text-white"
                        : "border-dark/30 bg-cream text-dark hover:bg-creamAlt"
                    }`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>
            {hasAnyFilter && (
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded border border-dark/30 bg-cream px-3 py-1.5 text-sm font-medium hover:bg-creamAlt"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && <p className="text-sm text-dark/70">Loading...</p>}

        {activeFilters.length > 0 && !loading && (
          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <p className="text-sm">
              <span className="font-medium">Active filters:</span> {activeFilters.join(" | ")}
            </p>
            <p className="mt-1 text-xs text-dark/70">
              Showing {priceHistory.length} price entries, grouped by {GROUP_BY_OPTIONS.find((g) => g.id === groupBy)?.label}
            </p>
          </div>
        )}

        {!hasAnyFilter && !loading && (
          <div className="rounded border border-dark/30 bg-creamAlt p-4 text-center">
            <p className="text-sm text-dark/70">Select at least one filter to view price trends</p>
          </div>
        )}

        {chartData && !loading && (
          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <div className="h-[400px]">
              {chartType === "line" && <Line data={chartData} options={chartOptions} />}
              {chartType === "bar" && <Bar data={chartData} options={chartOptions} />}
              {chartType === "scatter" && <Scatter data={chartData} options={chartOptions} />}
            </div>
            {chartType !== "bar" && (
              <div className="mt-3 flex items-center gap-4 text-xs text-dark/70">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-dark/50" />
                  Circle = Market
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rotate-45 bg-dark/50" />
                  Diamond = Buy
                </span>
              </div>
            )}
          </div>
        )}

        {priceHistory.length > 0 && !loading && (
          <div className="rounded border border-dark/30 bg-creamAlt p-4">
            <h3 className="mb-3 font-semibold">Price History Data</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-dark/30 text-xs uppercase">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Driver</th>
                    <th className="px-2 py-2">Parallel</th>
                    <th className="px-2 py-2">Serial</th>
                    <th className="px-2 py-2">Price</th>
                    <th className="px-2 py-2">Currency</th>
                    <th className="px-2 py-2">Price CNY</th>
                    <th className="px-2 py-2">Platform</th>
                    <th className="px-2 py-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((ph) => (
                    <tr key={ph.id} className="border-b border-dark/10">
                      <td className="px-2 py-2">{ph.date}</td>
                      <td className="px-2 py-2">{ph.driver || "-"}</td>
                      <td className="px-2 py-2">{ph.parallel || "-"}</td>
                      <td className="px-2 py-2">{ph.serialNumber || "-"}</td>
                      <td className="px-2 py-2">{ph.price.toFixed(2)}</td>
                      <td className="px-2 py-2">{ph.currency}</td>
                      <td className="px-2 py-2 font-medium text-accent">{ph.priceCny.toFixed(2)}</td>
                      <td className="px-2 py-2">{ph.platform || "-"}</td>
                      <td className="px-2 py-2">{ph.recordType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasAnyFilter && priceHistory.length === 0 && !loading && (
          <p className="text-sm text-dark/70">No price history found for the selected filters.</p>
        )}

        {priceHistory.length > 0 && (
          <AskAIPanel
            priceHistory={priceHistory}
            filters={{
              sets: selectedSets,
              drivers: selectedDrivers,
              cardTypes: selectedCardTypes,
              parallels: selectedParallels,
              platforms: selectedPlatforms,
            }}
          />
        )}
      </div>
    </div>
  );
}

function AskAIPanel({ priceHistory, filters }) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const presetQuestions = [
    "What's the overall price trend?",
    "Is now a good time to buy?",
    "Which parallel holds value best?",
    "Summarize the market for these cards",
  ];

  async function askQuestion(q) {
    const questionToAsk = q || question;
    if (!questionToAsk.trim()) return;

    setLoading(true);
    setError("");
    setResponse("");

    try {
      const res = await fetch(`${API_BASE}/analyze-trends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questionToAsk,
          priceHistory,
          filters,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResponse(data.response);
      } else {
        setError(data.error || "Failed to get response");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-dark/30 bg-creamAlt p-4">
      <h3 className="mb-3 font-semibold">Ask AI About This Data</h3>
      <p className="mb-3 text-xs text-dark/70">
        AI will analyze the {priceHistory.length} price entries currently displayed
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {presetQuestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setQuestion(q);
              askQuestion(q);
            }}
            disabled={loading}
            className="rounded border border-dark/30 bg-cream px-2 py-1 text-xs hover:bg-creamAlt disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && askQuestion()}
          placeholder="Ask a question about the price data..."
          disabled={loading}
          className="flex-1 rounded border border-dark/30 bg-cream p-2 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => askQuestion()}
          disabled={loading || !question.trim()}
          className="rounded border border-dark/30 bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Thinking..." : "Ask"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {response && (
        <div className="mt-4 rounded border border-dark/20 bg-cream p-3">
          <p className="mb-2 text-xs font-medium text-dark/70">AI Response:</p>
          <div className="whitespace-pre-wrap text-sm">{response}</div>
        </div>
      )}
    </div>
  );
}
