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
];

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
  });
  const [selectedSet, setSelectedSet] = useState("");
  const [selectedDriver, setSelectedDriver] = useState("");
  const [selectedCardType, setSelectedCardType] = useState("");
  const [selectedParallel, setSelectedParallel] = useState("");

  const hasAnyFilter = selectedSet || selectedDriver || selectedCardType || selectedParallel;

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/trend-options`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setFilterOptions(data.options || { sets: [], drivers: [], cardTypes: [], parallels: [] });
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
    if (selectedSet) params.set("set", selectedSet);
    if (selectedDriver) params.set("driver", selectedDriver);
    if (selectedCardType) params.set("cardType", selectedCardType);
    if (selectedParallel) params.set("parallel", selectedParallel);

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
  }, [selectedSet, selectedDriver, selectedCardType, selectedParallel, hasAnyFilter]);

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
      const dateMap = {};
      const dateRecordType = {};
      entries.forEach((e) => {
        if (!dateMap[e.date] || e.priceCny > dateMap[e.date]) {
          dateMap[e.date] = e.priceCny;
          dateRecordType[e.date] = e.recordType;
        }
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
    setSelectedSet("");
    setSelectedDriver("");
    setSelectedCardType("");
    setSelectedParallel("");
    setPriceHistory([]);
  }

  const activeFilters = [
    selectedSet && `Set: ${selectedSet}`,
    selectedDriver && `Driver: ${selectedDriver}`,
    selectedCardType && `Card Type: ${selectedCardType}`,
    selectedParallel && `Parallel: ${selectedParallel}`,
  ].filter(Boolean);

  const disabledGroupBy = {
    set: Boolean(selectedSet),
    driver: Boolean(selectedDriver),
    cardType: Boolean(selectedCardType),
    parallel: Boolean(selectedParallel),
  };

  const availableGroupByOptions = GROUP_BY_OPTIONS.filter((g) => !disabledGroupBy[g.id]);

  useEffect(() => {
    if (disabledGroupBy[groupBy] && availableGroupByOptions.length > 0) {
      setGroupBy(availableGroupByOptions[0].id);
    }
  }, [selectedSet, selectedDriver, selectedCardType, selectedParallel]);

  return (
    <div className="min-h-screen bg-cream p-6 text-dark">
      <div className="mx-auto max-w-7xl space-y-4">
        <h1 className="text-2xl font-bold">Price Trends</h1>
        <p className="text-sm text-dark/80">Filter by any combination and group by your choice</p>

        <div className="rounded border border-dark/30 bg-creamAlt p-4">
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">Filters</label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs text-dark/70">Set</label>
                <select
                  value={selectedSet}
                  onChange={(e) => setSelectedSet(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded border border-dark/30 bg-cream p-2 text-sm"
                >
                  <option value="">-- Any --</option>
                  {filterOptions.sets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark/70">Driver</label>
                <select
                  value={selectedDriver}
                  onChange={(e) => setSelectedDriver(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded border border-dark/30 bg-cream p-2 text-sm"
                >
                  <option value="">-- Any --</option>
                  {filterOptions.drivers.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark/70">Card Type</label>
                <select
                  value={selectedCardType}
                  onChange={(e) => setSelectedCardType(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded border border-dark/30 bg-cream p-2 text-sm"
                >
                  <option value="">-- Any --</option>
                  {filterOptions.cardTypes.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-dark/70">Parallel</label>
                <select
                  value={selectedParallel}
                  onChange={(e) => setSelectedParallel(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded border border-dark/30 bg-cream p-2 text-sm"
                >
                  <option value="">-- Any --</option>
                  {filterOptions.parallels.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
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
      </div>
    </div>
  );
}
