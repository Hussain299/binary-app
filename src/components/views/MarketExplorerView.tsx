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
  const requestSequence = useRef(0);

  const fetchPairData = useCallback(async (symbol: ForexSymbol, showLoader = true) => {
    const requestId = ++requestSequence.current;
    if (showLoader) setIsLoading(true);
    setLoadError(null);
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
        .sort((a: Candle, b: Candle) => a.timestampMs - b.timestampMs);
      setCandles(validCandles);
      setHoveredCandle(null);
      setActiveSource(data.source || '—');
      setQualityScore(Number.isFinite(data.qualityScore) ? data.qualityScore : null);
      if (validCandles.length < 2) setLoadError('Not enough valid candles are available for this pair yet.');
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      console.error('Failed to fetch candles:', error);
      setCandles([]);
      setActiveSource('—');
      setQualityScore(null);
      setLoadError(error instanceof Error ? error.message : 'Market data is temporarily unavailable.');
    } finally {
      if (requestId === requestSequence.current && showLoader) setIsLoading(false);
      else if (requestId === requestSequence.current) setIsLoading(false);
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

  const latestCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const changePips =
    latestCandle && firstCandle
      ? Number(
          ((latestCandle.close - firstCandle.open) * (selectedPair.includes('JPY') ? 100 : 10000)).toFixed(1)
        )
      : 0;

  // Render SVG Candlestick Chart
  const renderChart = () => {
    if (candles.length < 2) {
      return (
        <div className="h-72 flex items-center justify-center text-neutral-500 font-mono text-xs">
          Loading candle series...
        </div>
      );
    }

    const minPrice = Math.min(...candles.map(c => c.low));
    const maxPrice = Math.max(...candles.map(c => c.high));
    const priceRange = Math.max(0.0001, maxPrice - minPrice);

    const chartHeight = 280;
    const chartWidth = 900;
    const candleWidth = Math.max(3, Math.min(10, (chartWidth / candles.length) * 0.7));
    const spacing = chartWidth / candles.length;

    const getY = (price: number) => {
      return chartHeight - ((price - minPrice) / priceRange) * (chartHeight - 40) - 20;
    };

    return (
      <div className="relative w-full overflow-x-auto bg-neutral-950 p-4 border border-neutral-800 rounded">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-72 overflow-visible select-none"
        >
          {/* Horizontal Grid lines */}
          {[0.2, 0.4, 0.6, 0.8].map(ratio => {
            const price = maxPrice - ratio * priceRange;
            const y = getY(price);
            return (
              <g key={ratio}>
                <line
                  x1="0"
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#1f2937"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={chartWidth - 55}
                  y={y - 4}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {price.toFixed(selectedPair.includes('JPY') ? 3 : 5)}
                </text>
              </g>
            );
          })}

          {/* Candle Elements */}
          {candles.map((c, i) => {
            const isGreen = c.close >= c.open;
            const x = i * spacing + spacing / 2;
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const bodyY = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

            return (
              <g
                key={c.timestampMs}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredCandle(c)}
                onMouseLeave={() => setHoveredCandle(null)}
              >
                {/* Wick */}
                <line
                  x1={x}
                  y1={yHigh}
                  x2={x}
                  y2={yLow}
                  stroke={isGreen ? '#10b981' : '#f43f5e'}
                  strokeWidth="1.2"
                />
                {/* Candle Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isGreen ? '#10b981' : '#f43f5e'}
                  rx="0.5"
                />
              </g>
            );
          })}
        </svg>

        {/* OHLC Bar Inspector */}
        <div className="mt-3 pt-2 border-t border-neutral-850 flex items-center justify-between text-xs font-mono text-neutral-400">
          <div className="flex items-center gap-4">
            <span>
              O: <strong className="text-white">{(hoveredCandle || latestCandle)?.open}</strong>
            </span>
            <span>
              H: <strong className="text-white">{(hoveredCandle || latestCandle)?.high}</strong>
            </span>
            <span>
              L: <strong className="text-white">{(hoveredCandle || latestCandle)?.low}</strong>
            </span>
            <span>
              C: <strong className="text-white">{(hoveredCandle || latestCandle)?.close}</strong>
            </span>
            <span>
              Vol: <strong className="text-white">{(hoveredCandle || latestCandle)?.volume}</strong>
            </span>
          </div>
          <div className="text-[11px] text-neutral-500">
            Time: {(hoveredCandle || latestCandle)?.timestamp.substring(11, 19)} UTC
          </div>
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
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-white font-mono">{selectedPair} M1 Continuous</h3>
            <span className="text-xs font-mono text-neutral-400">
              Last: <strong className="text-white">{latestCandle?.close}</strong>
            </span>
            <span
              className={`text-xs font-mono font-medium flex items-center ${
                changePips >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {changePips >= 0 ? '+' : ''}
              {changePips} pips
            </span>
          </div>
          <div className="text-xs font-mono text-neutral-500">
            {candles.length} One-Minute Candles Cached
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
