# Production deployment and 24/5 paper-research operation

## Runtime model

SignalForge's market scheduler, learning reconciler, rolling candles, and JSON database are process-local. This application must run as a continuously available Node.js service. A successful build or HTTP health check does not prove that the market scheduler is receiving CPU time or that it is producing paper signals.

## Google Cloud Run

For the current single-process implementation:

1. Use **instance-based billing** so CPU remains allocated while the instance is idle between HTTP requests (Cloud Run's `--no-cpu-throttling` setting).
2. Set **minimum instances to 1** so the service does not scale to zero.
3. Set **maximum instances to 1**. The scheduler and JSON files are in-process/local; multiple instances would have separate schedulers and divergent databases.
4. Keep the container's command as `npm start` (or the equivalent Node command) and expose the configured `PORT`.
5. Expect instance replacement during maintenance, deployments, and failures. The server handles SIGTERM/SIGINT by stopping timers and flushing its local JSON state, but that flush does not turn the container filesystem into durable storage.

Example command (replace both placeholders with the actual Cloud Run service and region):

```bash
gcloud run services update SERVICE_NAME \
  --region REGION \
  --min 1 \
  --max 1 \
  --no-cpu-throttling
```

Instance-based billing and a minimum instance incur ongoing Cloud Run charges. Verify the billing mode and instance settings in the Cloud Run service configuration after applying them.

### Persistence is still a production blocker

The current database is `data/signalforge.db.json`; imported M1 candles are stored under `data/historical/`. Both are local files. They are not shared across instances and are not guaranteed to survive Cloud Run instance replacement. SIGTERM flushing only reduces loss during a graceful termination.

Before depending on the service across redeployments/restarts, migrate both the state database and historical candle partitions to a durable external store with atomic writes and single-writer/locking semantics. Merely setting min instances to 1 does not solve persistence.

## Signal eligibility

The live market pulse only accepts recent trusted provider/imported M1 candles. Synthetic continuity candles are display/continuity data and are never signal input.

A paper signal is emitted only when a stored strategy has passed the historical approval gate and matches the pair, session and entry timeframe. The current evolutionary research coordinator requires at least 60,000 genuine imported M1 candles for an eligible research pair before starting a new historical search. It does not manufacture candles or issue random fallback trades. When there are no qualified strategies, the bot can be running correctly and still emit zero signals; the Health page now exposes this as `NO_HISTORICALLY_QUALIFIED_STRATEGY`.

Signals produced by this application are paper research observations only. This deployment does not place broker orders.

## Operational verification after deployment

1. Open **Data health** and confirm the scheduler status is `HEALTHY`, the last heartbeat is recent, and the market state is `OPEN`.
2. Confirm fresh-feed count is nonzero and inspect pair diagnostics. `NO_FRESH_TRUSTED_M1_FEED`, `INSUFFICIENT_FRESH_M1_CANDLES`, and provider failures must be resolved at the feed/host layer.
3. Confirm the qualified-strategy count. If it is zero, import genuine chronological M1 history and run the approved research process; do not remove the evidence gate to force signals.
4. Confirm the process uptime and database state again after a controlled deployment/restart. Until external persistence is implemented, historical research and state can be lost on instance replacement.
