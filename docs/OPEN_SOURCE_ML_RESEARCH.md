# Open-source ML review for SignalForge

**Review date:** 2026-11-24  
**Purpose:** Identify reusable methods and architecture ideas for a resource-conscious, TypeScript-first forex research system.

This was a targeted review of high-relevance public repositories for online learning, concept drift, quantitative research, and contextual bandits. It is not a literal exhaustive scan of every repository on GitHub.

## Repositories reviewed

| Project | What it offers | Fit for SignalForge |
| --- | --- | --- |
| [River](https://github.com/online-ml/river) | Maintained Python library for streaming/online ML. Its core pattern is to predict on each observation and learn only when the label arrives. It includes online metrics and drift detectors such as ADWIN. | Best methodological fit. The repository is active and not archived, but adding a Python runtime/service would add deployment and memory cost. SignalForge now implements a narrow TypeScript shadow learner using the same prequential discipline. |
| [Microsoft Qlib](https://github.com/microsoft/qlib) | End-to-end quantitative investment research platform with data processing, supervised learning, market-dynamics modeling, reinforcement learning, and backtesting workflows. | Useful for research governance and evaluation design. It is a Python platform, not a library that can be safely dropped into this Express/TypeScript runtime. |
| [Microsoft RD-Agent](https://github.com/microsoft/RD-Agent) | Multi-agent R&D framework for automated factor discovery and joint factor/model optimization. | Useful inspiration for a future controlled scientist/auditor loop. Its full-stack workflows and Python dependencies are too large to import into the live scheduler. |
| [Thoughtworks simplebandit](https://github.com/thoughtworks/simplebandit) | Small TypeScript/JavaScript contextual-bandit library using online logistic regression and exploration. | Language fit is attractive, but GitHub marks the repository archived. SignalForge should not take a core runtime dependency on an archived package. |
| [scikit-multiflow](https://github.com/scikit-multiflow/scikit-multiflow) | Earlier Python streaming-ML toolkit and predecessor in the ecosystem from which River emerged. | Useful historical reference; River is the more suitable current reference for new online-learning patterns. |
| [TSLib](https://github.com/thuml/Time-Series-Library) | Research implementations for forecasting, imputation, anomaly detection, and classification. | Helpful for offline experimentation, but the maintainers' current notice says active feature development is limited. It is not appropriate as a production dependency here. |

## What was added

### Prequential online learning

A compact FTRL-Proximal logistic classifier lives in `src/server/onlineLearning.ts`.

- It consumes the same 19-dimensional causal feature vector used by SignalForge's symbolic strategy engine, plus pair, direction, and rule-family context.
- It records its prediction when the signal is created.
- It learns only after a verified, filled, closed WIN or LOSS. SCRATCH, CANCELLED, expired-before-entry, ambiguous, and unresolved signals do not become directional labels.
- On startup, it reconstructs the model by ordering prediction and outcome events by timestamp. Predictions at a timestamp are processed before outcomes at that same timestamp, so an outcome cannot influence a prediction made before it was knowable.
- Its output is explicitly shadow-only and has no connection to trade selection, strategy promotion, broker execution, payout gates, or entry timing.

### Adaptive drift monitoring

The learner tracks prequential Brier error in a bounded recent window and applies a two-subwindow Hoeffding comparison inspired by ADWIN. A drift event is telemetry only: it does not automatically reset weights, veto a strategy, or change trade behavior.

### Crash-safe outcome recovery

The database now has independent durable idempotency ledgers for strategy outcomes and forward-observation experiments. Startup recovery replays settled signals that may have been persisted as CLOSED just before a process interruption. The forward-observation ID ledger is separate from the UI experiment list, which is capped at 300 rows, and the strategy outcome ID ledger is no longer truncated while signal history is retained.

## What was deliberately not imported

- Qlib and RD-Agent are valuable research platforms but would create a separate Python subsystem, data contracts, runtime, and operational burden.
- simplebandit is archived.
- No new third-party runtime dependency was added. The TypeScript implementation is original project code informed by broadly documented online-learning patterns; it does not copy repository source.

## Safety and validation boundaries

This is not AGI, and no repository can turn a small-sample strategy bot into AGI. The appropriate engineering goal is a system that measures itself honestly, learns only from verified outcomes, detects changing behavior, documents its decisions, and refuses to promote models without evidence.

The new classifier remains shadow-only. Its first 100 verified outcomes are marked warm-up; reaching 100 does **not** automatically authorize it for trading. It must still demonstrate chronological out-of-sample skill, stable calibration, and robust performance across pairs, sessions, and payout conditions before it can influence any decision.

The existing entry contract, broker rules, minimum payout, untouched-holdout protections, and promotion thresholds are intentionally unchanged. Missed exact entry candles are not converted into invented fills. Entry misses need to be diagnosed from lifecycle evidence before any execution rule is changed.
