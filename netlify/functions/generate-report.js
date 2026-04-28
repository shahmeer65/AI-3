// netlify/functions/generate-report.js
//
// PRIVATE — This function runs exclusively on Netlify's servers.
// Nothing in this file is ever sent to or readable by the browser.
// The browser only receives the final { report: "..." } string.

const MODEL = require("./private-model-data.json");

// ─── CORS / preflight helper ──────────────────────────────────────────────────
const HEADERS = {
  "Access-Control-Allow-Origin":  "*",           // tighten to your domain in prod
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ─── Utility: resolve market tier from address string ────────────────────────
function resolveMarketTier(address) {
  const upper = address.toUpperCase();
  for (const [tierKey, tier] of Object.entries(MODEL.market_tiers)) {
    for (const market of tier.markets) {
      if (upper.includes(market.toUpperCase())) {
        return { key: tierKey, ...tier };
      }
    }
  }
  return { key: "tier_3", ...MODEL.market_tiers.tier_3 };
}

// ─── Core scoring engine (your proprietary logic lives here) ─────────────────
function scoreProperty(address, tier) {
  // ── Replace this block with your real scoring logic ──────────────────────
  // You have full access to MODEL.scoring_weights, MODEL.risk_adjustments,
  // MODEL.income_assumptions, comparable data, external APIs, etc.
  // Nothing computed here is visible to the client.

  const weights = MODEL.scoring_weights;

  // Example: deterministic seed from address string for demo stability
  const seed = address.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const jitter = (base, spread) => base + ((seed % (spread * 2)) - spread);

  const rawScores = {
    location_score:        jitter(72, 12),
    market_momentum:       jitter(68, 15),
    income_potential:      jitter(74, 10),
    supply_constraint:     jitter(65, 14),
    demographic_trend:     jitter(70, 11),
    infrastructure_access: jitter(66, 13),
  };

  // Clamp to 0–100
  for (const k of Object.keys(rawScores)) {
    rawScores[k] = Math.min(100, Math.max(0, rawScores[k]));
  }

  // Weighted composite
  let composite = 0;
  for (const [k, w] of Object.entries(weights)) {
    composite += (rawScores[k] || 0) * w;
  }
  composite = Math.round(composite);

  // Risk adjustments
  const activeRisks = [];
  // Example: apply flood zone flag if address mentions known flood areas
  // In production: call a geocoding + flood-zone API here
  if (seed % 7 === 0) {
    composite += MODEL.risk_adjustments.flood_zone;
    activeRisks.push({ flag: "flood_zone", delta: MODEL.risk_adjustments.flood_zone });
  }
  if (seed % 5 === 0) {
    composite += MODEL.risk_adjustments.transit_score_high;
    activeRisks.push({ flag: "transit_score_high", delta: MODEL.risk_adjustments.transit_score_high });
  }
  if (seed % 11 === 0) {
    composite += MODEL.risk_adjustments.opportunity_zone;
    activeRisks.push({ flag: "opportunity_zone", delta: MODEL.risk_adjustments.opportunity_zone });
  }

  composite = Math.min(100, Math.max(0, composite));

  // Verdict
  let verdict;
  if      (composite >= MODEL.thresholds.strong_buy) verdict = "STRONG BUY";
  else if (composite >= MODEL.thresholds.buy)        verdict = "BUY";
  else if (composite >= MODEL.thresholds.watch)      verdict = "WATCH";
  else if (composite >= MODEL.thresholds.avoid)      verdict = "AVOID";
  else                                               verdict = "PASS";

  return { rawScores, composite, activeRisks, verdict };
}

// ─── Income projection (your assumptions stay server-side) ───────────────────
function projectIncome(composite, tier) {
  const ia = MODEL.income_assumptions;
  const mp = MODEL.comparable_multipliers;

  // Estimate ARV from composite score + tier cap rate floor
  // Replace with real comps / AVM integration as needed
  const baseValue = 350_000 + composite * 3_200;
  const adjValue  = Math.round(baseValue * tier.growth_premium);

  const grossRent = Math.round(adjValue * 0.0082);           // ~0.82% rent-to-value
  const vacancy   = Math.round(grossRent * ia.vacancy_rate_default);
  const effectiveGrossIncome = grossRent - vacancy;
  const expenses  = Math.round(effectiveGrossIncome * ia.expense_ratio_default);
  const noi       = effectiveGrossIncome - expenses;
  const capRate   = ((noi / adjValue) * 100).toFixed(2);

  // Cash-on-cash (25% down, 7.2% rate, 30yr)
  const downPct    = 0.25;
  const loanAmt    = adjValue * (1 - downPct);
  const annualRate = 0.072 / 12;
  const n          = 360;
  const monthlyPI  = loanAmt * (annualRate * Math.pow(1 + annualRate, n)) /
                     (Math.pow(1 + annualRate, n) - 1);
  const annualDS   = monthlyPI * 12;
  const cashFlow   = noi - annualDS;
  const cocReturn  = ((cashFlow / (adjValue * downPct)) * 100).toFixed(2);

  return { adjValue, grossRent, noi, capRate, cashFlow, cocReturn };
}

// ─── Build the data payload sent to the AI prompt ────────────────────────────
function buildScoringData(address, score, income, tier) {
  return JSON.stringify({
    address,
    market_tier:    tier.label,
    composite_score: score.composite,
    verdict:         score.verdict,
    category_scores: score.rawScores,
    risk_adjustments: score.activeRisks,
    income_projection: {
      estimated_value:    `$${income.adjValue.toLocaleString()}`,
      gross_annual_rent:  `$${income.grossRent.toLocaleString()}`,
      noi:                `$${income.noi.toLocaleString()}`,
      cap_rate:           `${income.capRate}%`,
      annual_cash_flow:   `$${income.cashFlow.toLocaleString()}`,
      cash_on_cash:       `${income.cocReturn}%`,
    },
  }, null, 2);
}

// ─── Call Claude (or swap for any AI provider) ───────────────────────────────
async function callAI(address, scoringData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in environment.");

  // Inject scoring data into the private prompt template
  const prompt = MODEL.prompt_template
    .replace("{address}", address)
    .replace("{scoring_data}", scoringData);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":            "application/json",
      "x-api-key":               apiKey,
      "anthropic-version":       "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-opus-4-5",
      max_tokens: 1200,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "No report generated.";
}

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // ── Parse input ────────────────────────────────────────────────────────
    const body = JSON.parse(event.body || "{}");
    const address = (body.address || "").trim();

    if (!address || address.length < 5) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: "A valid property address is required." }),
      };
    }

    // ── Run proprietary scoring pipeline ──────────────────────────────────
    const tier        = resolveMarketTier(address);
    const score       = scoreProperty(address, tier);
    const income      = projectIncome(score.composite, tier);
    const scoringData = buildScoringData(address, score, income, tier);

    // ── Generate AI narrative report ───────────────────────────────────────
    const report = await callAI(address, scoringData);

    // ── Return only the finished report — no model internals ──────────────
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ report }),
    };

  } catch (err) {
    console.error("[generate-report]", err);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: "Report generation failed. Please try again." }),
    };
  }
};
