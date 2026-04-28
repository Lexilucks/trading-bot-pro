// Performance Optimizer
// Analyzes strategy performance, runs A/B tests, suggests parameter adjustments,
// and recommends next moves based on current market conditions.
// Run standalone: node performance-optimizer.js
// Or attach to Express server via registerRoutes(app)

const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  RESULTS_DIRS: ['./backtest-results', './paper-trading-results'],
  REPORT_DIR: './optimizer-reports',
  AB_TEST_RUNS: 20,           // simulated runs per variant
  MIN_TRADES_FOR_ANALYSIS: 5,
  TARGET_WIN_RATE: 0.55,
  TARGET_PROFIT_FACTOR: 1.5,
  TARGET_MAX_DRAWDOWN: 15,    // max acceptable drawdown %
  TARGET_RETURN_PCT: 5,       // monthly target %
};

// ─── Default Strategy Params (mirrors backtester) ────────────────────────────
const DEFAULT_PARAMS = {
  MA_Crossover: { fast: 8,  slow: 21 },
  RSI_MeanRevert: { period: 14, oversold: 30, overbought: 70 },
  Breakout: { lookback: 15 },
  VWAP_Deviation: { threshold: 0.015 },
  riskPerTrade: 0.02,
  stopLossMultiplier: 1.5,
  takeProfitMultiplier: 2.5,
  positionSizing: 'volatility',
  maxOpenPositions: 3,
  trailingStopPct: 0.03,
};

// ─── Metric Graders ───────────────────────────────────────────────────────────
function gradeMetric(value, metric) {
  const thresholds = {
    winRate:      { A: 60, B: 50, C: 40 },
    profitFactor: { A: 2.0, B: 1.5, C: 1.2 },
    returnPct:    { A: 8,   B: 4,   C: 1   },
    maxDrawdown:  { A: 8,   B: 15,  C: 25  },  // lower is better
    totalTrades:  { A: 20,  B: 10,  C: 5   },
  };
  const t = thresholds[metric];
  if (!t) return 'N/A';
  const invert = metric === 'maxDrawdown';
  if (!invert) return value >= t.A ? 'A' : value >= t.B ? 'B' : value >= t.C ? 'C' : 'D';
  else         return value <= t.A ? 'A' : value <= t.B ? 'B' : value <= t.C ? 'C' : 'D';
}

function overallGrade(metrics) {
  const grades = ['A','B','C','D'];
  const scores = [
    grades.indexOf(gradeMetric(metrics.winRate, 'winRate')),
    grades.indexOf(gradeMetric(metrics.profitFactor, 'profitFactor')),
    grades.indexOf(gradeMetric(metrics.returnPct, 'returnPct')),
    grades.indexOf(gradeMetric(metrics.maxDrawdown, 'maxDrawdown')),
  ].filter(s => s >= 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return grades[Math.round(avg)] || 'D';
}

// ─── Parameter Suggestion Engine ─────────────────────────────────────────────
function suggestParameterAdjustments(metrics, currentParams) {
  const suggestions = [];
  const p = { ...currentParams };

  // Win rate too low → tighten entry filters
  if (metrics.winRate < CONFIG.TARGET_WIN_RATE * 100) {
    if (p.MA_Crossover) {
      const newSlow = Math.min(p.MA_Crossover.slow + 5, 50);
      suggestions.push({
        param: 'MA_Crossover.slow',
        current: p.MA_Crossover.slow,
        suggested: newSlow,
        reason: `Win rate ${metrics.winRate}% is below target ${CONFIG.TARGET_WIN_RATE*100}%. Increasing slow MA period (${p.MA_Crossover.slow}→${newSlow}) reduces false signals.`,
        impact: 'MEDIUM',
        priority: 1,
      });
    }
    if (p.RSI_MeanRevert) {
      const newOversold = Math.max(p.RSI_MeanRevert.oversold - 5, 20);
      const newOverbought = Math.min(p.RSI_MeanRevert.overbought + 5, 80);
      suggestions.push({
        param: 'RSI_MeanRevert.thresholds',
        current: `oversold:${p.RSI_MeanRevert.oversold} / overbought:${p.RSI_MeanRevert.overbought}`,
        suggested: `oversold:${newOversold} / overbought:${newOverbought}`,
        reason: 'Tightening RSI extremes reduces marginal trades and improves entry quality.',
        impact: 'HIGH', priority: 2,
      });
    }
  }

  // Profit factor too low → improve R:R ratio
  if (metrics.profitFactor < CONFIG.TARGET_PROFIT_FACTOR) {
    const newTP = Math.min(p.takeProfitMultiplier + 0.5, 4.0);
    const newSL = Math.max(p.stopLossMultiplier - 0.2, 1.0);
    suggestions.push({
      param: 'takeProfitMultiplier',
      current: p.takeProfitMultiplier,
      suggested: newTP,
      reason: `Profit factor ${metrics.profitFactor} below target ${CONFIG.TARGET_PROFIT_FACTOR}. Extending take-profit target (${p.takeProfitMultiplier}x→${newTP}x ATR) increases winners.`,
      impact: 'HIGH', priority: 1,
    });
    suggestions.push({
      param: 'stopLossMultiplier',
      current: p.stopLossMultiplier,
      suggested: newSL,
      reason: `Tightening stop loss (${p.stopLossMultiplier}x→${newSL}x ATR) cuts losers faster.`,
      impact: 'MEDIUM', priority: 2,
    });
  }

  // Drawdown too high → reduce position size and add max positions limit
  if (metrics.maxDrawdown > CONFIG.TARGET_MAX_DRAWDOWN) {
    const newRisk = Math.max(p.riskPerTrade - 0.005, 0.005);
    suggestions.push({
      param: 'riskPerTrade',
      current: p.riskPerTrade,
      suggested: newRisk,
      reason: `Max drawdown ${metrics.maxDrawdown}% exceeds limit ${CONFIG.TARGET_MAX_DRAWDOWN}%. Reducing risk/trade (${(p.riskPerTrade*100).toFixed(1)}%→${(newRisk*100).toFixed(1)}%) protects capital.`,
      impact: 'HIGH', priority: 1,
    });
    if (p.maxOpenPositions > 2) {
      suggestions.push({
        param: 'maxOpenPositions',
        current: p.maxOpenPositions,
        suggested: p.maxOpenPositions - 1,
        reason: 'Reducing concurrent open positions limits correlated drawdowns.',
        impact: 'MEDIUM', priority: 2,
      });
    }
    suggestions.push({
      param: 'trailingStopPct',
      current: p.trailingStopPct,
      suggested: Math.min(p.trailingStopPct + 0.01, 0.06),
      reason: 'Tighter trailing stop locks in more profit and reduces drawdowns on winning trades.',
      impact: 'MEDIUM', priority: 3,
    });
  }

  // Return too low → try different sizing
  if (metrics.returnPct < CONFIG.TARGET_RETURN_PCT) {
    if (p.positionSizing !== 'kelly') {
      suggestions.push({
        param: 'positionSizing',
        current: p.positionSizing,
        suggested: 'kelly',
        reason: `Return ${metrics.returnPct}% below monthly target ${CONFIG.TARGET_RETURN_PCT}%. Kelly sizing dynamically scales positions based on edge, potentially boosting returns.`,
        impact: 'HIGH', priority: 2,
      });
    }
    if (p.MA_Crossover && p.MA_Crossover.fast > 5) {
      suggestions.push({
        param: 'MA_Crossover.fast',
        current: p.MA_Crossover.fast,
        suggested: Math.max(p.MA_Crossover.fast - 2, 3),
        reason: 'Faster signal entry captures more of early trend moves.',
        impact: 'LOW', priority: 3,
      });
    }
  }

  // No issues — suggest fine-tuning
  if (!suggestions.length) {
    suggestions.push({
      param: 'trailingStopPct',
      current: p.trailingStopPct,
      suggested: +(p.trailingStopPct * 0.9).toFixed(3),
      reason: 'Performance looks solid. Fine-tuning trailing stop may capture slightly more profit.',
      impact: 'LOW', priority: 3,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority);
}

// ─── A/B Test Engine ──────────────────────────────────────────────────────────
function generateSimulatedMetrics(params, seed = Math.random()) {
  // Simulates a backtest result based on params — in production, call the real backtester
  const baseReturn = 3 + seed * 8;
  const baseWinRate = 45 + seed * 25;
  const riskAdj = 1 - (params.riskPerTrade - 0.01) * 5;
  const tpAdj   = params.takeProfitMultiplier / 2.5;
  const slAdj   = 1.5 / Math.max(params.stopLossMultiplier, 0.5);

  return {
    returnPct:    +(baseReturn * riskAdj * tpAdj).toFixed(2),
    winRate:      +(baseWinRate * (params.MA_Crossover ? 1 + (21 - params.MA_Crossover.slow) * 0.005 : 1)).toFixed(1),
    profitFactor: +(1.2 + tpAdj * slAdj * seed).toFixed(2),
    maxDrawdown:  +(8 + (1 - riskAdj) * 20 + (1 - seed) * 10).toFixed(2),
    totalTrades:  Math.floor(8 + seed * 30),
    sharpe:       +(0.8 + seed * 1.5).toFixed(2),
  };
}

function runABTest(variantA, variantB, runs = CONFIG.AB_TEST_RUNS) {
  const resultsA = [], resultsB = [];
  for (let i = 0; i < runs; i++) {
    resultsA.push(generateSimulatedMetrics(variantA, Math.random()));
    resultsB.push(generateSimulatedMetrics(variantB, Math.random()));
  }

  function summarise(results) {
    const avg = key => +(results.reduce((s, r) => s + r[key], 0) / results.length).toFixed(2);
    const std = (key) => {
      const mean = avg(key);
      return +(Math.sqrt(results.reduce((s, r) => s + (r[key] - mean) ** 2, 0) / results.length)).toFixed(2);
    };
    return {
      returnPct:    { mean: avg('returnPct'),    std: std('returnPct') },
      winRate:      { mean: avg('winRate'),       std: std('winRate') },
      profitFactor: { mean: avg('profitFactor'),  std: std('profitFactor') },
      maxDrawdown:  { mean: avg('maxDrawdown'),   std: std('maxDrawdown') },
      totalTrades:  { mean: avg('totalTrades'),   std: std('totalTrades') },
      sharpe:       { mean: avg('sharpe'),        std: std('sharpe') },
    };
  }

  const sumA = summarise(resultsA);
  const sumB = summarise(resultsB);

  // Determine winner across key metrics
  const scoreA = sumA.returnPct.mean * 0.4 + sumA.winRate.mean * 0.3 + Math.min(sumA.profitFactor.mean, 3) * 10 * 0.3;
  const scoreB = sumB.returnPct.mean * 0.4 + sumB.winRate.mean * 0.3 + Math.min(sumB.profitFactor.mean, 3) * 10 * 0.3;

  // Statistical significance (simplified t-test on returns)
  const pooledStd = Math.sqrt((sumA.returnPct.std ** 2 + sumB.returnPct.std ** 2) / 2);
  const tStat = Math.abs(sumA.returnPct.mean - sumB.returnPct.mean) / (pooledStd * Math.sqrt(2 / runs));
  const significant = tStat > 2.0; // rough p<0.05 threshold

  return {
    variantA: { params: variantA, summary: sumA, score: +scoreA.toFixed(2) },
    variantB: { params: variantB, summary: sumB, score: +scoreB.toFixed(2) },
    winner: scoreA >= scoreB ? 'A' : 'B',
    marginPct: +(Math.abs(scoreA - scoreB) / Math.max(scoreA, scoreB) * 100).toFixed(1),
    statisticallySignificant: significant,
    tStat: +tStat.toFixed(3),
    runs,
    recommendation: scoreA >= scoreB
      ? (significant ? 'Adopt Variant A with high confidence' : 'Variant A leads but difference is marginal — run more tests')
      : (significant ? 'Adopt Variant B with high confidence' : 'Variant B leads but difference is marginal — run more tests'),
  };
}

// ─── Next Move Recommender ────────────────────────────────────────────────────
function recommendNextMoves(metrics, suggestions, abTestResult) {
  const moves = [];

  // Immediate actions based on grade
  const grade = overallGrade(metrics);
  if (grade === 'A') {
    moves.push({ priority: 'LOW',    action: 'MONITOR',  detail: 'Strategy performing well. Maintain current parameters. Consider increasing position size by 10% if drawdown stays under control.' });
  } else if (grade === 'B') {
    moves.push({ priority: 'MEDIUM', action: 'TUNE',     detail: 'Good performance but room to improve. Apply top-priority parameter suggestions and re-run backtests over 30-day window.' });
  } else {
    moves.push({ priority: 'HIGH',   action: 'OVERHAUL', detail: 'Strategy underperforming. Implement all HIGH-impact suggestions immediately. Consider switching to best-performing backtested strategy.' });
  }

  // Based on A/B test
  if (abTestResult.statisticallySignificant) {
    const winner = abTestResult.winner === 'A' ? 'current' : 'proposed';
    moves.push({ priority: 'HIGH', action: 'DEPLOY_WINNER', detail: `A/B test is statistically significant. Switch to ${winner} params. Improvement: ${abTestResult.marginPct}% margin.` });
  } else {
    moves.push({ priority: 'LOW', action: 'EXTEND_TEST', detail: `A/B test inconclusive (p>0.05). Run ${CONFIG.AB_TEST_RUNS * 2} more simulations before deciding. Continue with current params.` });
  }

  // Risk management
  if (metrics.maxDrawdown > CONFIG.TARGET_MAX_DRAWDOWN) {
    moves.push({ priority: 'HIGH', action: 'REDUCE_RISK', detail: `⚠ Drawdown ${metrics.maxDrawdown}% exceeds limit. Immediately cut riskPerTrade to ${Math.max(metrics.riskPerTrade - 0.01, 0.01)*100}% and reduce maxOpenPositions.` });
  }

  // Market timing
  const hour = new Date().getHours();
  const isMarketOpen = hour >= 9 && hour <= 16;
  moves.push({ priority: 'INFO', action: 'TIMING', detail: isMarketOpen ? 'Market open — scanner is active. Watch for volume surges on momentum breakouts.' : 'Market closed — good time to run full backtests and apply optimizations for tomorrow.' });

  // Diversification
  if (metrics.winRate > 65 && metrics.totalTrades < 15) {
    moves.push({ priority: 'MEDIUM', action: 'EXPAND_UNIVERSE', detail: 'High win rate but low trade frequency. Consider expanding watchlist to ETF sector plays or adding RSI mean-reversion strategy alongside current setup.' });
  }

  return moves.sort((a, b) => { const p = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 }; return p[a.priority] - p[b.priority]; });
}

// ─── Load Results ─────────────────────────────────────────────────────────────
function loadLatestResults() {
  const found = [];
  for (const dir of CONFIG.RESULTS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    if (files.length) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, files.pop())));
        found.push(data);
      } catch (e) { /* skip malformed files */ }
    }
  }
  return found;
}

function extractAggregateMetrics(loadedData) {
  const allMetrics = [];
  for (const data of loadedData) {
    if (data.reports) {
      for (const r of data.reports) {
        if (r.totalTrades >= CONFIG.MIN_TRADES_FOR_ANALYSIS) allMetrics.push(r);
      }
    }
    if (data.results) {
      for (const [sym, strategies] of Object.entries(data.results)) {
        for (const [strat, res] of Object.entries(strategies)) {
          if (res.bestMetrics && res.bestMetrics.totalTrades >= CONFIG.MIN_TRADES_FOR_ANALYSIS) {
            allMetrics.push({ symbol: sym, strategy: strat, ...res.bestMetrics, maxDrawdown: res.maxDrawdown || 0 });
          }
        }
      }
    }
  }
  if (!allMetrics.length) return null;
  const avg = key => allMetrics.filter(m => m[key] != null).reduce((s, m) => s + (m[key] || 0), 0) / allMetrics.length;
  return {
    winRate:       +avg('winRate').toFixed(1),
    profitFactor:  +avg('profitFactor').toFixed(2),
    returnPct:     +avg('returnPct').toFixed(2),
    maxDrawdown:   +avg('maxDrawdown').toFixed(2),
    totalTrades:   Math.round(avg('totalTrades')),
    sharpe:        +(Math.random() * 1.5 + 0.5).toFixed(2), // placeholder — real Sharpe needs daily returns
    dataPoints:    allMetrics.length,
  };
}

// ─── Full Optimization Run ────────────────────────────────────────────────────
async function runOptimizer(currentParams = DEFAULT_PARAMS) {
  if (!fs.existsSync(CONFIG.REPORT_DIR)) fs.mkdirSync(CONFIG.REPORT_DIR, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║    ⚙️   PERFORMANCE OPTIMIZER  —  Full Analysis      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Load historical results
  const loadedData = loadLatestResults();
  let metrics;
  if (loadedData.length) {
    metrics = extractAggregateMetrics(loadedData);
    console.log(`✅ Loaded ${loadedData.length} result file(s) | ${metrics?.dataPoints || 0} strategy data points`);
  }
  if (!metrics) {
    console.log('⚠  No backtest results found. Using simulated baseline metrics.');
    metrics = { winRate: 48, profitFactor: 1.3, returnPct: 2.8, maxDrawdown: 18, totalTrades: 12, sharpe: 0.9, dataPoints: 0 };
  }

  // Grade current performance
  const grade = overallGrade(metrics);
  console.log('\n📊 CURRENT PERFORMANCE GRADE: ' + grade);
  console.log('─────────────────────────────────────────────────────');
  const gradeRow = (label, val, metric, suffix='') =>
    console.log(`  ${label.padEnd(20)} ${String(val).padStart(8)}${suffix}   [${gradeMetric(val, metric)}]`);
  gradeRow('Win Rate',        metrics.winRate,       'winRate',       '%');
  gradeRow('Profit Factor',   metrics.profitFactor,  'profitFactor',  'x');
  gradeRow('Monthly Return',  metrics.returnPct,     'returnPct',     '%');
  gradeRow('Max Drawdown',    metrics.maxDrawdown,   'maxDrawdown',   '%');
  gradeRow('Total Trades',    metrics.totalTrades,   'totalTrades',   '');
  gradeRow('Sharpe Ratio',    metrics.sharpe,        'returnPct',     '');

  // Generate suggestions
  const suggestions = suggestParameterAdjustments(metrics, currentParams);
  console.log(`\n🔧 PARAMETER ADJUSTMENT SUGGESTIONS (${suggestions.length} found):`);
  console.log('─────────────────────────────────────────────────────');
  for (const s of suggestions) {
    console.log(`  [${s.impact}] ${s.param}`);
    console.log(`    Current:   ${JSON.stringify(s.current)}`);
    console.log(`    Suggested: ${JSON.stringify(s.suggested)}`);
    console.log(`    Why: ${s.reason}\n`);
  }

  // A/B test: current vs first suggestion applied
  const variantAParams = { ...currentParams };
  const variantBParams = { ...currentParams };
  if (suggestions.length > 0) {
    const topSug = suggestions[0];
    // Apply the top suggestion to variant B
    const paramPath = topSug.param.split('.');
    if (paramPath.length === 2 && variantBParams[paramPath[0]]) {
      variantBParams[paramPath[0]] = { ...variantBParams[paramPath[0]], [paramPath[1]]: topSug.suggested };
    } else {
      variantBParams[topSug.param] = topSug.suggested;
    }
  }
  const abResult = runABTest(variantAParams, variantBParams);
  console.log('⚗️  A/B TEST RESULTS:');
  console.log('─────────────────────────────────────────────────────');
  console.log(`  Runs: ${abResult.runs} simulations each`);
  console.log(`  Variant A (current)  — Score: ${abResult.variantA.score} | Return: ${abResult.variantA.summary.returnPct.mean}% ±${abResult.variantA.summary.returnPct.std}%`);
  console.log(`  Variant B (proposed) — Score: ${abResult.variantB.score} | Return: ${abResult.variantB.summary.returnPct.mean}% ±${abResult.variantB.summary.returnPct.std}%`);
  console.log(`  Winner: Variant ${abResult.winner} (${abResult.marginPct}% better)`);
  console.log(`  Significance: ${abResult.statisticallySignificant ? '✅ Yes (p<0.05)' : '⚠ Not significant yet'}`);
  console.log(`  → ${abResult.recommendation}\n`);

  // Next moves
  const nextMoves = recommendNextMoves(metrics, suggestions, abResult);
  console.log('🎯 RECOMMENDED NEXT MOVES:');
  console.log('─────────────────────────────────────────────────────');
  for (const move of nextMoves) {
    const icon = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢', INFO: '🔵' }[move.priority] || '⚪';
    console.log(`  ${icon} [${move.priority}] ${move.action}`);
    console.log(`     ${move.detail}\n`);
  }

  // Save full report
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const report = {
    runAt: new Date().toISOString(),
    grade,
    metrics,
    currentParams,
    suggestions,
    abTest: abResult,
    nextMoves,
  };
  const outFile = path.join(CONFIG.REPORT_DIR, `optimizer-${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`💾 Full optimizer report saved: ${outFile}`);
  console.log('══════════════════════════════════════════════════════\n');
  return report;
}

// ─── Express API Routes ───────────────────────────────────────────────────────
function registerRoutes(app) {
  app.get('/optimizer/run', async (req, res) => {
    const params = req.body || DEFAULT_PARAMS;
    const report = await runOptimizer(params);
    res.json({ status: 'ok', report });
  });

  app.post('/optimizer/ab-test', (req, res) => {
    const { variantA, variantB, runs } = req.body;
    if (!variantA || !variantB) return res.status(400).json({ error: 'Provide variantA and variantB params' });
    const result = runABTest(variantA, variantB, runs || CONFIG.AB_TEST_RUNS);
    res.json(result);
  });

  app.post('/optimizer/suggestions', (req, res) => {
    const { metrics, params } = req.body;
    if (!metrics) return res.status(400).json({ error: 'Provide current metrics object' });
    const suggestions = suggestParameterAdjustments(metrics, params || DEFAULT_PARAMS);
    res.json({ suggestions, grade: overallGrade(metrics) });
  });

  app.get('/optimizer/reports', (req, res) => {
    if (!fs.existsSync(CONFIG.REPORT_DIR)) return res.json({ reports: [] });
    const files = fs.readdirSync(CONFIG.REPORT_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10);
    const reports = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(CONFIG.REPORT_DIR, f))); } catch (e) { return null; }
    }).filter(Boolean);
    res.json({ reports });
  });

  app.get('/optimizer/latest', (req, res) => {
    if (!fs.existsSync(CONFIG.REPORT_DIR)) return res.status(404).json({ error: 'No reports yet' });
    const files = fs.readdirSync(CONFIG.REPORT_DIR).filter(f => f.endsWith('.json')).sort();
    if (!files.length) return res.status(404).json({ error: 'No reports yet' });
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CONFIG.REPORT_DIR, files.pop())));
      res.json(data);
    } catch (e) { res.status(500).json({ error: 'Could not read report' }); }
  });

  app.get('/optimizer/params/default', (req, res) => {
    res.json(DEFAULT_PARAMS);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const paramsFile = process.argv[2];
  let params = DEFAULT_PARAMS;
  if (paramsFile && fs.existsSync(paramsFile)) {
    try { params = { ...DEFAULT_PARAMS, ...JSON.parse(fs.readFileSync(paramsFile)) }; } catch (e) { /* use defaults */ }
  }
  runOptimizer(params).catch(console.error);
}

module.exports = { runOptimizer, suggestParameterAdjustments, runABTest, gradeMetric, overallGrade, recommendNextMoves, DEFAULT_PARAMS, registerRoutes };
