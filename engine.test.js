const assert = require('node:assert/strict');
const E = require('./engine.js');

const data = {
  dca: [{ ticker: '0050', name: 'ETF', entries: [
    { date: '2026-01-02', type: 'scheduled', shares: 100, pricePerShare: 50, amount: 5000 },
    { date: '2026-01-03', type: 'skipped', shares: 100, pricePerShare: 51 },
    { date: '2026-01-05', type: 'sell', shares: 40, pricePerShare: 60, amount: 2400 }
  ] }],
  direct: [{ ticker: '2330', name: 'Stock', transactions: [
    { date: '2026-01-02', shares: 10, costPerShare: 100, totalCost: 1000 },
    { date: '2026-01-07', type: 'buy', shares: 10, costPerShare: 120, totalCost: 1200 },
    { date: '2026-01-08', type: 'sell', shares: 15, costPerShare: 130, totalCost: 1950 }
  ] }]
};
assert.equal(E.trades(data).length, 5, 'skipped DCA record is excluded');
const selected = E.selectTrades(data, { from: '2026-01-05', to: '2026-01-05', ticker: '0050', side: 'sell' });
assert.equal(selected.filteredTotal, 1);
assert.equal(selected.items[0].side, 'sell');
const manyData = { dca: [], direct: [{ ticker: '2330', transactions: Array.from({ length: 1001 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), type: 'buy', shares: 1, costPerShare: 100
})) }] };
assert.deepEqual([E.selectTrades(manyData).filteredTotal, E.selectTrades(manyData).pageCount], [1001, 51]);
assert.deepEqual([E.selectTrades(manyData, { page: 51 }).items.length, E.selectTrades(manyData, { page: 100 }).page], [1, 51]);
const holdings = E.holdings(data);
assert.deepEqual(holdings.map(item => [item.ticker, item.shares, item.cost, item.realized]), [
  ['0050', 60, 3000, 400], ['2330', 5, 600, 350]
]);

const rows = Array.from({ length: 120 }, (_, i) => {
  const close = i < 65 ? 100 : i < 95 ? 100 + (i - 65) * 2 : 160 - (i - 95) * 3;
  return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1000 };
});
assert.equal(E.technical(rows).date, rows.at(-1).date);
const breakoutRows = rows.map((row, i) => i === rows.length - 1 ? { ...row, high: 1000, low: 1 } : row);
assert.equal(E.technical(breakoutRows).high20, Math.max(...rows.slice(-21, -1).map(row => row.high)), 'breakout reference excludes latest candle');
assert.equal(E.technical(breakoutRows).low20, Math.min(...rows.slice(-21, -1).map(row => row.low)), '20-day low reference excludes latest candle');
const swingRows = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: i === 60 ? 108 : i === 75 ? 92 : 100,
  high: i === 60 ? 110 : i === 75 ? 93 : 101, low: i === 75 ? 90 : i === 60 ? 107 : 99, close: i === 60 ? 108 : i === 75 ? 92 : 100, volume: 1000 }));
const swings = E.technical(swingRows);
assert.ok(swings.supportLow < 90 && swings.supportHigh > 90, 'a distinct swing low creates a support zone');
assert.ok(swings.resistanceLow < 110 && swings.resistanceHigh > 110, 'a distinct swing high creates a resistance zone');
assert.ok(swings.supportLow <= swings.supportHigh && swings.resistanceLow <= swings.resistanceHigh, 'engine zone boundaries are ordered');
assert.equal(swings.supportTurns, 1);
assert.equal(swings.resistanceTurns, 1);
const flatRows = swingRows.map(row => ({ ...row, open: 100, close: 100, high: 101, low: 99 }));
assert.equal(E.technical(flatRows).supportLow, null, 'no qualifying turn means no fabricated support');
assert.equal(E.technical(flatRows).resistanceLow, null, 'no qualifying turn means no fabricated resistance');
assert.equal(E.technical(swingRows.map((row, i) => i === 99 ? { ...row, high: 200, low: 1 } : row)).resistanceTurns, 1, 'latest candle does not create a confirmed turn');

const srDate = i => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
const srBar = (i, close = 100, options = {}) => ({ date: srDate(i), open: close, close,
  high: options.high ?? close + 1, low: options.low ?? close - 1, volume: options.volume ?? 1000 });
const peakHistory = Array.from({ length: 100 }, (_, i) => srBar(i, i === 60 ? 108 : 100, i === 60 ? { high: 110, low: 107 } : {}));
const resistanceAt110 = history => E.horizontalZones(history).find(zone => zone.low > 108 && zone.high < 112);
assert.ok(resistanceAt110(peakHistory), 'substantial closing-price reaction qualifies a swing');
assert.equal(E.horizontalZones(peakHistory.map((row, i) => i === 60 ? srBar(i, 101, { high: 102 }) : row)).length, 0, 'minor local high is rejected');
assert.equal(E.horizontalZones(peakHistory.map((row, i) => i === 60 ? srBar(i, 100, { high: 110 }) : row)).length, 0, 'large wick without closing reaction is rejected');
assert.equal(resistanceAt110(peakHistory.slice(0, 68)), undefined, 'swing is unavailable before eight subsequent candles');
assert.ok(resistanceAt110(peakHistory.slice(0, 69)), 'swing appears when historical reaction is observable');
const laterVolatility = peakHistory.map((row, i) => i >= 70 ? { ...row, high: 105, low: 95 } : row);
assert.ok(resistanceAt110(laterVolatility).high - resistanceAt110(laterVolatility).low < 5, 'later volatility does not resize an old turn');
const flatThenBreak = Array.from({ length: 110 }, (_, i) => srBar(i, i >= 100 ? 105 : 100));
assert.ok(E.horizontalZones(flatThenBreak).some(zone => zone.source.includes('盤整') && zone.low <= 100 && zone.high >= 100), 'sustained sideways prices form a consolidation candidate after departure');
const trending = Array.from({ length: 110 }, (_, i) => srBar(i, 100 + i * 0.4));
assert.equal(E.horizontalZones(trending).length, 0, 'ordinary trend does not become price consolidation');
const chainedPeaks = Array.from({ length: 125 }, (_, i) => { const peak = [40, 60, 80, 100].indexOf(i); return srBar(i, peak >= 0 ? 108 + peak : 100, peak >= 0 ? { high: 110 + peak, low: 107 + peak } : {}); });
assert.ok(E.horizontalZones(chainedPeaks).every(zone => zone.high - zone.low < 4), 'nearby levels cannot chain into a broad band');
const strongFarPeak = Array.from({ length: 120 }, (_, i) => srBar(i, i === 40 ? 112 : i === 80 ? 103.5 : 100,
  i === 40 ? { high: 115, low: 111 } : i === 80 ? { high: 105, low: 102.5 } : {}));
assert.ok(E.horizontalZones(strongFarPeak).some(zone => zone.low > 113), 'stronger relevant turn outranks weak nearby turn');
const inZone = resistanceAt110([...peakHistory, srBar(100, 110)]);
assert.equal(inZone.status, '區內觀察', 'current price inside the zone remains visible');
assert.equal(inZone.location, '區內');
assert.equal(resistanceAt110([...peakHistory, srBar(100, 108.5)]).status, '接近區間');
const wickOnly = resistanceAt110([...peakHistory, srBar(100, 100, { high: 115 })]);
assert.notEqual(wickOnly.status, '突破未確認', 'intraday wick alone is not a breakout');
const upBreak = srBar(100, 113, { volume: 1500 });
assert.equal(resistanceAt110([...peakHistory, upBreak]).status, '突破未確認');
assert.equal(resistanceAt110([...peakHistory, upBreak]).volumeRatioBreak, 1.5, 'upward break records relative volume');
assert.equal(resistanceAt110([...peakHistory, srBar(100, 113, { volume: 900 })]).status, '突破未確認', 'upward break without volume remains observational');
const acceptedUp = [...peakHistory, upBreak, srBar(101, 114), srBar(102, 115)];
assert.equal(resistanceAt110(acceptedUp).status, '區外站穩', 'three closing prices establish acceptance');
assert.equal(resistanceAt110([...acceptedUp, srBar(103, 115)]).status, '等待回測');
const upRetest = [...acceptedUp, srBar(103, 113, { low: 109, high: 114 })];
assert.equal(resistanceAt110(upRetest).status, '回測中', 'a single retest candle does not confirm a role reversal');
const reversedUp = resistanceAt110([...upRetest, srBar(104, 114)]);
assert.equal(reversedUp.status, '角色互換已確認');
assert.equal(reversedUp.role, 'support', 'former resistance becomes support only after retest');
assert.equal(resistanceAt110([...peakHistory, upBreak, srBar(101, 100)]).status, '突破／跌破失敗', 'early return inside is a failed break');
assert.equal(resistanceAt110([...acceptedUp, srBar(103, 98)]).status, '突破／跌破失敗', 'failed retest does not reverse the role');
const troughHistory = Array.from({ length: 100 }, (_, i) => srBar(i, i === 60 ? 92 : 100, i === 60 ? { low: 90, high: 93 } : {}));
const supportAt90 = history => E.horizontalZones(history).find(zone => zone.low < 90 && zone.high > 90);
const downBreak = srBar(100, 87, { volume: 500 });
assert.equal(supportAt90([...troughHistory, downBreak]).status, '跌破未確認', 'low volume does not block a downward break');
const acceptedDown = [...troughHistory, downBreak, srBar(101, 86), srBar(102, 85)];
assert.equal(supportAt90(acceptedDown).status, '區外站穩');
const downRetest = [...acceptedDown, srBar(103, 87, { high: 91, low: 86 })];
assert.equal(supportAt90(downRetest).status, '回測中');
assert.equal(supportAt90([...downRetest, srBar(104, 86)]).role, 'resistance', 'confirmed breakdown and later close reverse support');
function reactionHistory(nextCloses) {
  const history = Array.from({ length: 110 }, (_, i) => srBar(i, i === 60 ? 92 : i < 69 ? 100 : 94, i === 60 ? { low: 90, high: 93 } : {}));
  [75, 85, 95].forEach((i, j) => { history[i] = srBar(i, 91, { low: 90, high: 94 }); history[i + 1] = srBar(i + 1, nextCloses[j]); });
  return history;
}
assert.equal(supportAt90(reactionHistory([98, 96, 94])).reactionTrend, '轉弱', 'separated rebounds weaken');
assert.equal(supportAt90(reactionHistory([94, 96, 98])).reactionTrend, '轉強', 'separated rebounds strengthen');
assert.equal(supportAt90(reactionHistory([98, 96, 94]).slice(0, 93)).reactionTrend, '證據不足或無一致趨勢', 'two tests do not establish a trend');
assert.equal(E.horizontalZones(Array.from({ length: 100 }, (_, i) => srBar(i))).length, 0, 'no qualifying price evidence means no S/R zone');
const weeklyRows = Array.from({ length: 240 }, (_, i) => ({ ...rows[i % rows.length], date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), close: 100 + i * 0.1 }));
assert.ok(E.weeklyTrend(weeklyRows, weeklyRows.at(-1).date)?.ma30);
const test = E.backtest(rows);
assert.ok(test && test.trades >= 1, 'crossovers create closed trades');
assert.ok(test.tradeRows[0].entryDate > rows[65].date, 'trade executes after signal day');
assert.ok(test.maxDrawdown <= 0);
assert.ok(Math.abs(test.totalReturn - (test.finalEquity - 1) * 100) < 0.02);
assert.ok(test.drawdownTrough && test.drawdownPeak.date <= test.drawdownTrough.date);
assert.ok(Math.abs(test.maxDrawdown - (test.drawdownTrough.value / test.drawdownPeak.value - 1) * 100) < 0.02);
assert.equal(E.backtest(rows.slice(0, 50)), null);

const risk = E.portfolioRisk(data, { '0050': rows, '2330': rows, IX0001: rows });
assert.equal(risk.coverage, 2);
assert.equal(risk.betaCoverage, 2);
assert.equal(risk.estimatedLoss, -risk.total * 0.2);
assert.equal(risk.pairs.length, 1);
assert.equal(risk.pairs[0].value, 1);
assert.equal(E.portfolioRisk(data, { '0050': rows, '2330': rows }).estimatedLoss, null, 'missing benchmark suppresses total scenario');

const journal = E.journal(data, { '0050': rows, '2330': rows });
assert.equal(journal.total, 5);
assert.equal(journal.recent.length, 5);
assert.equal(journal.notes, 0);
assert.equal(journal.closed, 2);
assert.equal(journal.realized, 750);
console.log('engine tests passed');
