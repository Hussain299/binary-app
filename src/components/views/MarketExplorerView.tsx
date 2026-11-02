import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart,
  Activity,
  Layers,
  Database,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Candle, FOREX_PAIRS, ForexSymbol, ProviderHealth } from '../../types/index.js';
import { getLatestObservedCandle, getMarketChartPriceDomain, getTrustedMarketCandles } from '../../utils/marketChart.ts';

interface MarketExplorerViewProps {
  providers: ProviderHealth[];
}

export const MarketExplorerView: React.FC<MarketExplorerViewProps> = ({ providers }) => {
  const [selectedPair, setSelectedPair] = useState<ForexSymbol>('EUR/USD');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activeSource, setActiveSource] = useState<string>('');
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const fetchPairData = useCallback(async (symbol: ForexSymbol, showLoader = true) => {
    const requestId = ++requestSequence.current;
    if (showLoader) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const res = await fetch(`/api/forex-candles?symbol=${encodeURIComponent(symbol.replace('/', ''))}&limit=80`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Market data request failed (${res.status}).`);
      if (requestId !== requestSequence.current) return;
      const validCandles = (Array.isArray(data.candles) ? data.candles : [])
        .filter((c: Candle) => c && Number.isFinite(c.timestampMs) &&
          [c.open, c.high, c.low, c.close].every(Number.isFinite) &&
          c.high >= Math.max(c.open, c.close, c.low) &&
          c.low <= Math.min(c.open, c.close, c.high))
        .map((c: Candle) => ({
          ...c,
          timestamp: typeof c.timestamp === 'string' && Number.isFinite(Date.parse(c.timestamp))
            ? c.timestamp
            : new Date(c.timestampMs).toISOString(),
        }))
        .sort((a: Candle, b: Candle) => a.timestampMs - b.timestampMs);
      setCandles(validCandles);
      setHoveredCandle(null);
      setActiveSource(data.source || '—');
      setQualityScore(Number.isFinite(data.qualityScore) ? data.qualityScore : null);
      setRefreshWarning(null);
      if (validCandles.length < 2) {
        setLoadError('Not enough valid candles are available for this pair yet.');
      } else {
        setLoadError(null);
      }
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      console.error('Failed to fetch candles:', error);
      const message = error instanceof Error ? error.message : 'Market data is temporarily unavailable.';
      if (showLoader) {
        setCandles([]);
        setActiveSource('—');
        setQualityScore(null);
        setLoadError(message);
      } else {
        // A transient polling failure must not erase the last valid chart.
        setRefreshWarning('Live refresh failed. Showing the last successfully received market snapshot.');
      }
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPairData(selectedPair);
    const refresh = window.setInterval(() => void fetchPairData(selectedPair, false), 15_000);
    return () => {
      window.clearInterval(refresh);
      requestSequence.current += 1;
    };
  }, [selectedPair, fetchPairData]);

  const trustedCandles = getTrustedMarketCandles(candles);
  const latestCandle = getLatestObservedCandle(candles);
  const firstCandle = trustedCandles[0] ?? null;
  const syntheticCount = candles.filter(candle => candle.source === 'synthetic').length;
  const latestAgeSeconds = latestCandle
    ? Math.max(0, Math.floor((Date.now() - latestCandle.timestampMs) / 1000))
    : null;
  const changePips =
    latestCandle && firstCandle
      ? Number(
          ((latestCandle.close - firstCandle.open) * (selectedPair.includes('JPY') ? 100 : 10000)).toFixed(1)
        )
      : 0;

  // Responsive SVG candlestick chart. Synthetic continuity candles are
  // deliberately rendered in muted grey so they cannot be mistaken for live quotes.
  const renderChart = () => {
    if (candles.length < 2) {
      return (
        <div className="flex h-[330px] items-center justify-center text-neutral-500 font-mono text-xs">
          Waiting for at least two valid M1 candles…
        </div>
      );
    }

    const isJpy = selectedPair.includes('JPY');
    const priceDomain = getMarketChartPriceDomain(candles, isJpy);
    if (!priceDomain) {
      return <div className="flex h-[330px] items-center justify-center text-xs text-rose-300">Chart price scale is unavailable for this candle set.</div>;
    }
    const minPrice = priceDomain.min;
    const maxPrice = priceDomain.max;
    const priceRange = priceDomain.range;

    const chartWidth = 1000;
    const chartHeight = 330;
    const plotLeft = 18;
    const plotRight = 890;
    const plotTop = 22;
    const plotBottom = 265;
    const plotHeight = plotBottom - plotTop;
    const slotWidth = (plotRight - plotLeft) / candles.length;
    const candleWidth = Math.max(3, Math.min(9, slotWidth * 0.62));
    const getY = (price: number) =>
      plotBottom - ((price - minPrice) / priceRange) * plotHeight;
    const formatPrice = (price: number) => price.toFixed(isJpy ? 3 : 5);
    const formatUtcTime = (timestampMs: number) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(timestampMs));
    const selectedIndex = hoveredCandle
      ? candles.findIndex(item => item.timestampMs === hoveredCandle.timestampMs)
      : -1;
    const inspectedCandle = selectedIndex >= 0 ? candles[selectedIndex] : candles[candles.length - 1];
    const latestY = getY(latestCandle?.close ?? inspectedCandle.close);
    const tickIndices = Array.from(new Set([
      0,
      Math.round((candles.length - 1) * 0.25),
      Math.round((candles.length - 1) * 0.5),
      Math.round((candles.length - 1) * 0.75),
      candles.length - 1,
    ]));

    return (
      <div className="sf-chart-frame p-3 sm:p-4">
        <div className="sf-chart-scroll">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${selectedPair} one-minute candlestick chart with ${candles.length} candles`}
          >
            <defs>
              <linearGradient id="sf-latest-price-fill" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#8ce7b9" stopOpacity=".04" />
                <stop offset="100%" stopColor="#8ce7b9" stopOpacity=".16" />
              </linearGradient>
            </defs>

            {/* Price grid and right-hand price scale. */}
            {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
              const y = plotTop + ratio * plotHeight;
              const price = maxPrice - ratio * priceRange;
              return (
                <g key={ratio}>
                  <line className="sf-chart-grid" x1={plotLeft} y1={y} x2={plotRight} y2={y} />
                  <text className="sf-chart-axis" x={plotRight + 12} y={y + 3.5}>
                    {formatPrice(price)}
                  </text>
                </g>
              );
            })}

            {/* Latest traded/observed close. */}
            {latestCandle && (
              <g>
                <rect x={plotLeft} y={latestY - 10} width={plotRight - plotLeft} height="20" fill="url(#sf-latest-price-fill)" />
                <line x1={plotLeft} y1={latestY} x2={plotRight} y2={latestY}
                  stroke="#8ce7b9" strokeWidth="1" strokeDasharray="5 5" opacity=".72" />
              </g>
            )}

            {/* Candle wicks and bodies. */}
            {candles.map((candle, index) => {
              const isSynthetic = candle.source === 'synthetic';
              const isUp = candle.close >= candle.open;
              const tone = isSynthetic ? '#7d8b98' : isUp ? '#43cf99' : '#f17480';
              const x = plotLeft + (index + 0.5) * slotWidth;
              const yHigh = getY(candle.high);
              const yLow = getY(candle.low);
              const yOpen = getY(candle.open);
              const yClose = getY(candle.close);
              const bodyY = Math.min(yOpen, yClose);
              const bodyHeight = Math.max(1.8, Math.abs(yClose - yOpen));
              const isSelected = index === selectedIndex;
              return (
                <g
                  key={candle.timestampMs}
                  className="sf-chart-candle"
                  opacity={isSynthetic ? 0.5 : 1}
                  onMouseEnter={() => setHoveredCandle(candle)}
                  onMouseLeave={() => setHoveredCandle(null)}
                  onFocus={() => setHoveredCandle(candle)}
                  onClick={() => setHoveredCandle(candle)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${formatUtcTime(candle.timestampMs)} UTC. Open ${formatPrice(candle.open)}, high ${formatPrice(candle.high)}, low ${formatPrice(candle.low)}, close ${formatPrice(candle.close)}. ${isSynthetic ? 'Synthetic continuity candle' : 'Provider candle'}.`}
                >
                  <title>
                    {formatUtcTime(candle.timestampMs)} UTC · O {formatPrice(candle.open)} · H {formatPrice(candle.high)} · L {formatPrice(candle.low)} · C {formatPrice(candle.close)} · {candle.source}
                  </title>
                  {isSelected && (
                    <line className="sf-chart-crosshair" x1={x} y1={plotTop} x2={x} y2={plotBottom} />
                  )}
                  <line x1={x} y1={yHigh} x2={x} y2={yLow}
                    stroke={tone} strokeWidth={isSelected ? 1.8 : 1.25} vectorEffect="non-scaling-stroke" />
                  <rect
                    x={x - candleWidth / 2}
                    y={bodyY}
                    width={candleWidth}
                    height={bodyHeight}
                    fill={isUp && !isSynthetic ? tone : isSynthetic ? 'rgba(125,139,152,.42)' : tone}
                    stroke={tone}
                    strokeWidth={isSelected ? 1.6 : 0.6}
                    rx="1"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {/* Time axis in UTC. */}
            <line x1={plotLeft} y1={plotBottom + 7} x2={plotRight} y2={plotBottom + 7}
              stroke="rgba(148,163,184,.22)" strokeWidth="1" />
            {tickIndices.map(index => {
              const candle = candles[index];
              const x = plotLeft + (index + 0.5) * slotWidth;
              return (
                <g key={candle.timestampMs}>
                  <line x1={x} y1={plotBottom + 7} x2={x} y2={plotBottom + 12}
                    stroke="rgba(148,163,184,.3)" />
                  <text className="sf-chart-axis" x={x} y={plotBottom + 29} textAnchor="middle">
                    {formatUtcTime(candle.timestampMs)}
                  </text>
                </g>
              );
            })}
            <text className="sf-chart-axis" x={plotRight + 12} y={plotBottom + 29}>UTC</text>
          </svg>
        </div>

        <div className="sf-chart-inspector mt-3 font-mono text-[11px]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-neutral-400">
            <span>O <strong className="text-neutral-100">{formatPrice(inspectedCandle.open)}</strong></span>
            <span>H <strong className="text-neutral-100">{formatPrice(inspectedCandle.high)}</strong></span>
            <span>L <strong className="text-neutral-100">{formatPrice(inspectedCandle.low)}</strong></span>
            <span>C <strong className="text-neutral-100">{formatPrice(inspectedCandle.close)}</strong></span>
            <span>VOL <strong className="text-neutral-100">{Number(inspectedCandle.volume || 0).toLocaleString()}</strong></span>
          </div>
          <div className="flex items-center gap-2 text-neutral-500">
            <span>{formatUtcTime(inspectedCandle.timestampMs)} UTC</span>
            <span className={inspectedCandle.source === 'synthetic' ? 'text-amber-300' : 'text-emerald-300'}>
              {inspectedCandle.source}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-neutral-500">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-emerald-400" /> Up</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-rose-400" /> Down</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-sm bg-slate-500" /> Synthetic continuity</span>
          <span className="ml-auto">Hover or tap a candle to inspect · UTC</span>
        </div>
      </div>
    );
  };

  return (
    <div className="sf-page">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.07] pb-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">Markets</h3>
          <p className="mt-1 text-xs text-neutral-500">M1 price snapshots and measured data-feed health.</p>
        </div>
        <span className="text-[10px] text-neutral-500">Market data · not execution prices</span>
      </div>
      {/* Pair Selector & Feed Health Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <label htmlFor="market-pair" className="text-[11px] text-neutral-500">Pair</label>
          <select
            id="market-pair"
            value={selectedPair}
            onChange={event => setSelectedPair(event.target.value as ForexSymbol)}
            className="min-w-[150px] rounded-lg border border-white/[0.08] bg-[#111a26] px-3 py-2 text-xs font-medium text-white outline-none"
          >
            {FOREX_PAIRS.map(pair => <option key={pair} value={pair}>{pair}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 text-neutral-500">
            <span>Feed</span>
            <span className="font-medium uppercase text-neutral-200">{activeSource || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-neutral-500">
            <span>Quality</span>
            <span className="font-medium text-neutral-200">{qualityScore === null ? '—' : `${qualityScore}/100`}</span>
          </div>
        </div>
      </div>

      {/* Main Chart Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="text-base font-bold text-white font-mono">{selectedPair} M1</h3>
            <span className="text-xs font-mono text-neutral-400">
              Last observed: <strong className="text-white">{latestCandle?.close?.toFixed(selectedPair.includes('JPY') ? 3 : 5) ?? '—'}</strong>
            </span>
            <span className={`text-xs font-mono font-medium ${changePips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {changePips >= 0 ? '+' : ''}{changePips} pips
            </span>
            <span className="rounded-md border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[9px] uppercase tracking-wide text-neutral-300">
              {activeSource || 'Feed pending'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-neutral-500">
            {trustedCandles.length} trusted · {candles.length} displayed · {latestAgeSeconds === null ? 'no provider candle' : `${latestAgeSeconds}s old`}
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-72 items-center justify-center rounded-xl border border-white/[.07] bg-[#080d15] text-xs text-neutral-400">
            <Activity className="mr-2 h-4 w-4 animate-pulse" /> Loading {selectedPair} candles…
          </div>
        ) : loadError ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-rose-400/15 bg-rose-400/[.035] px-5 text-center">
            <AlertCircle className="h-5 w-5 text-rose-300" />
            <p className="max-w-md text-xs text-neutral-300">{loadError}</p>
            <button type="button" onClick={() => void fetchPairData(selectedPair)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white hover:bg-white/5">Retry market data</button>
          </div>
        ) : renderChart()}
        {syntheticCount > 0 && !isLoading && (
          <div className="sf-market-source-warning">
            {syntheticCount} synthetic continuity candle{syntheticCount === 1 ? '' : 's'} are shown in muted grey because the provider feed was delayed. They are not live market observations. “Last observed” and the pip change use trusted provider/imported candles only.
          </div>
        )}
        {refreshWarning && !isLoading && (
          <p className="text-[10px] text-amber-300">{refreshWarning}</p>
        )}
      </div>

      {/* Feed status: only measured provider states are shown. */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-neutral-200">Feed status</h4>
          <span className="text-[10px] text-neutral-500">{providers.length} provider observations</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['biquote', 'dukascopy', 'yahoo'] as const).map(provider => {
            const rows = providers.filter(item => item.provider === provider);
            const healthy = rows.filter(item => item.status === 'ONLINE').length;
            const degraded = rows.filter(item => item.status === 'DEGRADED').length;
            const failed = rows.filter(item => item.status === 'FAILED').length;
            const status = rows.length === 0 ? 'NO DATA' : failed > 0 ? 'FAILED' : degraded > 0 ? 'DEGRADED' : 'ONLINE';
            const label = provider === 'biquote' ? 'Biquote' : provider === 'dukascopy' ? 'Dukascopy' : 'Yahoo Finance';
            return (
              <div key={provider} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0c131d] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-neutral-200">{label}</div>
                  <div className="mt-0.5 text-[10px] text-neutral-500">
                    {rows.length ? `${healthy} online · ${degraded} degraded · ${failed} failed` : 'No recent observation'}
                  </div>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-[9px] font-semibold tracking-wide
                  ${status === 'ONLINE' ? 'bg-emerald-400/10 text-emerald-300' : status === 'DEGRADED' ? 'bg-amber-400/10 text-amber-300' : status === 'FAILED' ? 'bg-rose-400/10 text-rose-300' : 'bg-white/[0.05] text-neutral-500'}`}>
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
