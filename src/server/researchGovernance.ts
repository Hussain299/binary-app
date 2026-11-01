/**
 * Research-governance rules for truthful forensic learning.
 *
 * A settled loss is an observation. OHLC alone does not establish a causal
 * mechanism, and a single outcome must never manufacture a validated antidote.
 */

import type { LossAutopsy } from "../types/index.js";

export const OBSERVATION_ONLY_LESSONS = [
  "The contract outcome is recorded as an observation; no causal mechanism has been established.",
  "This single outcome must not create, validate, or promote a strategy or an antidote.",
  "Causal explanations require a separately registered hypothesis and independent supporting evidence.",
];

export function sanitizeLossAutopsy(autopsy: LossAutopsy): LossAutopsy {
  const hadUnverifiedCause = autopsy.rootCause !== "OBSERVED_ADVERSE_SETTLEMENT";
  const hasLegacyAntidote = Boolean(
    autopsy.antidoteStrategyGeneId ||
    autopsy.antidoteStrategyName ||
    autopsy.antidoteFormula ||
    autopsy.antidoteOperator
  );
  const hasUnverifiedLessons = Array.isArray(autopsy.lessonsLearned) &&
    autopsy.lessonsLearned.some(lesson => !OBSERVATION_ONLY_LESSONS.includes(lesson));

  const legacyClaims = [
    autopsy.legacyUnverifiedExplanation,
    hadUnverifiedCause ? autopsy.rootCauseExplanation : undefined,
    hasLegacyAntidote
      ? [
          autopsy.antidoteStrategyName,
          autopsy.antidoteFormula,
          autopsy.antidoteOperator,
        ].filter(Boolean).join(" | ")
      : undefined,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const legacyLessons = [
    ...(autopsy.legacyUnverifiedLessons || []),
    ...(hasUnverifiedLessons ? autopsy.lessonsLearned : []),
  ];

  return {
    ...autopsy,
    rootCause: "OBSERVED_ADVERSE_SETTLEMENT",
    evidenceStatus: "OBSERVATION_ONLY",
    rootCauseExplanation:
      "A loss was observed and recorded. The available trade outcome and OHLC context do not establish its causal mechanism.",
    lessonsLearned: [...OBSERVATION_ONLY_LESSONS],
    legacyUnverifiedExplanation: legacyClaims.length
      ? [...new Set(legacyClaims)].join("\n")
      : undefined,
    legacyUnverifiedLessons: legacyLessons.length
      ? [...new Set(legacyLessons)]
      : undefined,
    antidoteStrategyGeneId: undefined,
    antidoteStrategyName: undefined,
    antidoteFormula: undefined,
    antidoteOperator: undefined,
  };
}
