const assert = require('node:assert/strict');
const Charts = require('./charts.js');
const Engine = require('./engine.js');

const rows = Array.from({ length: 120 }, (_, i) => {
  const close = 100 + i * 0.2 + Math.sin(i / 6) * 3;
  return { date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + i * 10 };
});
const analysis = Engine.technical(rows);
const chart = Charts.candlestick(rows, analysis);
assert.match(chart, /<svg/);
assert.match(chart, /支撐/);
assert.match(chart, /壓力/);
assert.match(chart, /MA20/);
assert.match(chart, /60日回歸趨勢線/);
assert.match(chart, /data-chart-readout/);
assert.match(chart, /data-chart-point="candle"/);
assert.equal((chart.match(/data-chart-point="candle"/g) || []).length, 120, 'chart shows the full 120-candle S/R detection window');
assert.match(chart, /technical-chart/);
assert.doesNotMatch(chart, /NaN|Infinity/);
const flat = rows.map(row => ({ ...row, high: 101, low: 99, open: 100, close: 100 }));
const noZoneChart = Charts.candlestick(flat, Engine.technical(flat));
assert.doesNotMatch(noZoneChart, /候選支撐 [0-9]|候選壓力 [0-9]|NaN|Infinity/, 'missing turns do not draw false zones');
const turnRows = rows.map((row, i) => ({ ...row, open: i === 60 ? 108 : 100, close: i === 60 ? 108 : 100, high: i === 60 ? 110 : 101, low: i === 60 ? 107 : 99 }));
const turnChart = Charts.candlestick(turnRows, Engine.technical(turnRows));
assert.match(turnChart, /壓力區：109\./, 'chart labels the shaded resistance zone');
assert.match(turnChart, /109\.[0-9]+–110\.[0-9]+/, 'chart labels zone as a price range');
assert.match(turnChart, /<g class="chart-zone-label"><(?:line|path)[^>]+stroke-dasharray="3 3"[^>]*\/><rect[^>]+fill="#ffffff" fill-opacity="\.94"/, 'label has a readable background and a zone connector');
const labelBox = turnChart.match(/<g class="chart-zone-label"><(?:line|path)[^>]+\/><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
assert.ok(labelBox, 'resistance label is drawn inside the chart');
const [, labelX, labelY, labelWidth, labelHeight] = labelBox.map(Number);
const candleWicks = [...turnChart.matchAll(/<g><title>[^<]+<\/title><line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/g)];
assert.ok(candleWicks.every(([, cx, highY, lowY]) => Number(cx) < labelX || Number(cx) > labelX + labelWidth || Number(highY) > labelY + labelHeight || Number(lowY) < labelY), 'label does not cover candle wicks');
const chartLines = [...turnChart.matchAll(/<polyline points="([\d., ]+)" fill="none" stroke="(?:#f3c76b|#8fc7ff|#b996f4)"/g)]
  .flatMap(([, points]) => points.split(' ').map(point => point.split(',').map(Number)));
assert.ok(chartLines.every(([px, py]) => px < labelX || px > labelX + labelWidth || py < labelY || py > labelY + labelHeight), 'label does not cover moving averages or regression points');
assert.ok(turnChart.indexOf('chart-zone-label') > turnChart.indexOf('stroke="#f3c76b"'), 'zone label renders above moving averages');
const reversedBounds = Charts.candlestick(rows, { ...analysis, srZones: [
  { role: 'resistance', low: 2460.48, high: 2457.71, status: '候選區間' },
  { role: 'support', low: 110.25, high: 108.31, status: '等待回測' }
] });
assert.match(reversedBounds, /壓力區：2,457\.71–2,460\.48/, 'resistance boundaries display ascending');
assert.match(reversedBounds, /原支撐區：108\.31–110\.25/, 'support boundaries display ascending with status');
const zoneHeights = [...reversedBounds.matchAll(/<rect x="60" y="[\d.]+" width="778" height="([\d.]+)" fill="(?:#6bc7a0|#e7b66a)" opacity="\.17"\/>/g)].map(match => Number(match[1]));
assert.equal(zoneHeights.length, 2);
assert.ok(zoneHeights.every(height => height > 0), 'both shaded zones retain positive height');
assert.match(Charts.sparkline(rows), /收盤走勢/);
assert.match(Charts.equity(Engine.backtest(rows), rows), /累積報酬比較/);
assert.match(Charts.equity(Engine.backtest(rows), rows), /data-chart-point="equity"/);
assert.match(Charts.equity(Engine.backtest(rows), rows), /stroke-dasharray="7 4"/);
assert.match(Charts.equity(Engine.backtest(rows), rows), /軸刻度只是讀圖參考/);
assert.match(Charts.allocation([{ ticker: '<script>', weight: 45 }]), /&lt;script&gt;/);
assert.doesNotMatch(Charts.allocation([{ ticker: '<script>', weight: 45 }]), /<script>/);
assert.match(Charts.outcomes([{ ticker: '0050', date: '2026-05-01', day1: 2, day5: -3 }]), /5 個交易日後/);
const outcomes = Charts.outcomes([
  { ticker: '0050', date: '2026-05-01', side: 'buy', day1: 2, day5: -3 },
  { ticker: '0050', date: '2026-05-08', side: 'buy', day1: 1, day5: 4 }
]);
assert.match(outcomes, /2026-05-01 · 0050 · 買入/);
assert.match(outcomes, /2026-05-08 · 0050 · 買入/);
assert.match(outcomes, /-5%/);
assert.match(outcomes, /\+5%/);
assert.match(outcomes, /outcome-bar day1/);
assert.match(outcomes, /outcome-bar day5/);
console.log('chart tests passed');
