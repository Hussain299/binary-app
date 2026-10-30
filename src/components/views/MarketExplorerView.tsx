import React, { useState, useEffect } from 'react';
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
  const [activeSource, setActiveSource] = useState<string>('biquote');
  const [qualityScore, setQualityScore] = useState<number>(95);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  const fetchPairData = async (symbol: ForexSymbol) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/forex-candles?symbol=${symbol.replace('/', '')}&limit=80`);
      if (res.ok) {
        const data = await res.json();
        setCandles(data.candles || []);
        setActiveSource(data.source || 'biquote');
        setQualityScore(data.qualityScore || 90);
      }
    } catch (e) {
      console.error('Failed to fetch candles:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPairData(selectedPair);
  }, [selectedPair]);

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
            const y = chartHeight * ratio;
            const price = maxPrice - ratio * priceRange;
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
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-950 p-6 space-y-6">
      {/* Pair Selector & Feed Health Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {FOREX_PAIRS.map(pair => (
            <button
              key={pair}
              onClick={() => setSelectedPair(pair)}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors ${
                selectedPair === pair
                  ? 'bg-neutral-800 text-white font-semibold border border-neutral-700'
                  : 'text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800/80'
              }`}
            >
              {pair}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span>Active Source:</span>
            <span className="text-emerald-400 font-semibold uppercase">{activeSource}</span>
          </div>
          <div className="flex items-center gap-1.5 text-neutral-400">
            <span>Data Quality:</span>
            <span className="text-white font-semibold">{qualityScore}/100</span>
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

        {renderChart()}
      </div>

      {/* Provider Health Matrix & Architecture */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 text-xs font-mono space-y-2">
          <div className="text-neutral-400 uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tier 1 Provider: Biquote.io</span>
          </div>
          <p className="text-neutral-300">
            Direct public forex endpoint (<code className="text-neutral-400">/api/symbol/ohlc</code>).
            Unfinished candles stripped; timestamps converted to ISO UTC.
          </p>
          <div className="text-[11px] text-neutral-500">Status: Active / Monitored</div>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 text-xs font-mono space-y-2">
          <div className="text-neutral-400 uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Tier 2 Fallback: Dukascopy</span>
          </div>
          <p className="text-neutral-300">
            Dukascopy secondary feed with institutional bid/ask midpoints. Engages automatically if
            Biquote exceeds 4s timeout.
          </p>
          <div className="text-[11px] text-neutral-500">Status: Standby Ready</div>
        </div>

        <div className="bg-neutral-900/60 border border-neutral-800 rounded p-4 text-xs font-mono space-y-2">
          <div className="text-neutral-400 uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-purple-400" />
            <span>Tier 3 Fallback: Yahoo Finance</span>
          </div>
          <p className="text-neutral-300">
            Chart v8 endpoint fallback. Handles weekend/session boundary fills with realistic
            continuity engine.
          </p>
          <div className="text-[11px] text-neutral-500">Status: Standby Ready</div>
        </div>
      </div>
    </div>
  );
};
