(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ResearchCharts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const n = value => Number(value).toFixed(2);
  const price = value => Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const line = (points, color, width = 2, extra = '') => points.length > 1 ? `<polyline points="${points.map(p => `${n(p[0])},${n(p[1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>` : '';
  const svg = (title, body, height = 340, className = '') => `<div class="chart-wrap ${className}"><svg viewBox="0 0 920 ${height}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet"><title>${esc(title)}</title>${body}</svg></div>`;
  const bounds = values => { const min = Math.min(...values), max = Math.max(...values); const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.01, 0.01); return [min - pad, max + pad]; };

  function candlestick(allRows, analysis) {
    const rows = allRows.slice(-120);
    if (!rows.length || !analysis) return '';
    const left = 60, right = 838, top = 24, bottom = 292, volumeTop = 316, volumeBottom = 383;
    const zones = analysis.srZones || [];
    const [min, max] = bounds([...rows.flatMap(row => [row.low, row.high]), ...zones.flatMap(item => [item.low, item.high])].filter(Number.isFinite));
    const y = value => bottom - (value - min) / (max - min) * (bottom - top);
    const x = i => left + (i + 0.5) * (right - left) / rows.length;
    const candleWidth = Math.max(3, (right - left) / rows.length * 0.58);
    const volumeMax = Math.max(...rows.map(row => row.volume), 1);
    const grid = Array.from({ length: 5 }, (_, i) => {
      const value = min + (max - min) * i / 4, yy = y(value);
      return `<line x1="${left}" y1="${n(yy)}" x2="${right}" y2="${n(yy)}" stroke="#304158" stroke-dasharray="3 5"/><text x="846" y="${n(yy + 4)}">${n(value)}</text>`;
    }).join('');
    const candles = rows.map((row, i) => {
      const xx = x(i), up = row.close >= row.open, color = up ? '#e57479' : '#6bc7a0';
      const bodyTop = Math.min(y(row.open), y(row.close)), bodyHeight = Math.max(1.4, Math.abs(y(row.open) - y(row.close)));
      const volumeHeight = row.volume / volumeMax * (volumeBottom - volumeTop);
      return `<g><title>${esc(`${row.date} 開 ${n(row.open)} 高 ${n(row.high)} 低 ${n(row.low)} 收 ${n(row.close)} 量 ${row.volume}`)}</title><line x1="${n(xx)}" y1="${n(y(row.high))}" x2="${n(xx)}" y2="${n(y(row.low))}" stroke="${color}" stroke-width="1.5"/><rect x="${n(xx - candleWidth / 2)}" y="${n(bodyTop)}" width="${n(candleWidth)}" height="${n(bodyHeight)}" fill="${color}"/><rect x="${n(xx - candleWidth / 2)}" y="${n(volumeBottom - volumeHeight)}" width="${n(candleWidth)}" height="${n(volumeHeight)}" fill="${color}" opacity=".6"/></g>`;
    }).join('');
    function maPoints(period) {
      const points = [];
      for (let i = 0; i < rows.length; i++) {
        const end = allRows.length - rows.length + i + 1;
        if (end < period) continue;
        const mean = allRows.slice(end - period, end).reduce((sum, row) => sum + row.close, 0) / period;
        points.push([x(i), y(mean)]);
      }
      return points;
    }
    const trendRows = rows.slice(-60), trendOffset = rows.length - trendRows.length;
    const meanX = (trendRows.length - 1) / 2;
    const meanY = trendRows.reduce((sum, row) => sum + row.close, 0) / trendRows.length;
    const covariance = trendRows.reduce((sum, row, i) => sum + (i - meanX) * (row.close - meanY), 0);
    const variance = trendRows.reduce((sum, _, i) => sum + (i - meanX) ** 2, 0);
    const slope = variance ? covariance / variance : 0;
    const ma20 = maPoints(20), ma60 = maPoints(60);
    const trendPoints = [[x(trendOffset), y(meanY - slope * meanX)], [x(rows.length - 1), y(meanY + slope * meanX)]];
    const trend = line(trendPoints, '#b996f4', 2, 'stroke-dasharray="7 5"');
    const zone = (low, high, color) => {
      if (!Number.isFinite(low) || !Number.isFinite(high)) return '';
      const lower = Math.min(low, high), upper = Math.max(low, high);
      return `<rect x="${left}" y="${n(y(upper))}" width="${right - left}" height="${n(y(lower) - y(upper))}" fill="${color}" opacity=".17"/>`;
    };
    const dates = [...new Set([0, Math.round((rows.length - 1) / 4), Math.round((rows.length - 1) / 2), Math.round((rows.length - 1) * 3 / 4), rows.length - 1])].map(i => `<text x="${n(x(i))}" y="406" text-anchor="middle">${esc(rows[i].date.slice(5))}</text>`).join('');
    const legend = `<g class="chart-legend"><text x="${left}" y="432" fill="#e57479">● 上漲K</text><text x="145" y="432" fill="#6bc7a0">● 下跌K</text><text x="250" y="432" fill="#f3c76b">━ MA20</text><text x="360" y="432" fill="#8fc7ff">━ MA60</text><text x="470" y="432" fill="#b996f4">┄ 60日回歸趨勢線</text><text x="670" y="432" fill="#91a6bf">量能在下方</text></g>`;
    const hits = rows.map((row, i) => {
      const change = i ? (row.close / rows[i - 1].close - 1) * 100 : 0;
      return `<rect class="chart-hit" data-chart-point="candle" data-date="${esc(row.date)}" data-open="${n(row.open)}" data-high="${n(row.high)}" data-low="${n(row.low)}" data-close="${n(row.close)}" data-volume="${esc(row.volume)}" data-change="${n(change)}" data-x="${n(x(i))}" x="${n(left + i * (right - left) / rows.length)}" y="${top}" width="${n((right - left) / rows.length)}" height="${volumeBottom - top}" fill="transparent" tabindex="0" aria-label="${esc(`${row.date} 開 ${n(row.open)} 高 ${n(row.high)} 低 ${n(row.low)} 收 ${n(row.close)} 量 ${row.volume}`)}"/>`;
    }).join('');
    const zoneTitle = item => {
      const pending = ['突破未確認', '跌破未確認', '區外站穩', '等待回測', '回測中'].includes(item.status);
      return `${pending ? '原' : ''}${item.role === 'support' ? '支撐區' : '壓力區'}`;
    };
    const bands = zones.map(item => zone(item.low, item.high, item.role === 'support' ? '#6bc7a0' : '#e7b66a')).join('');
    const placedLabels = [];
    const zoneLabels = zones.map(item => {
      const lower = Math.min(item.low, item.high), upper = Math.max(item.low, item.high);
      const label = `${zoneTitle(item)}：${price(lower)}–${price(upper)}`;
      const width = Math.min(right - left - 8, Math.ceil(24 + [...label].reduce((sum, char) => sum + (/[^\u0000-\u007f]/.test(char) ? 13 : 7.5), 0)));
      const height = 22, zoneEdge = item.role === 'support' ? y(lower) : y(upper);
      const firstY = item.role === 'resistance' ? 2 : top + 2;
      const lastY = item.role === 'support' ? volumeTop - height : bottom - height - 2;
      const positions = Array.from({ length: Math.floor((lastY - firstY) / 2) + 1 }, (_, i) => firstY + i * 2);
      positions.sort((a, b) => Math.abs(a - zoneEdge) - Math.abs(b - zoneEdge));
      const overlaps = (xx, yy) => {
        const x0 = xx - 4, x1 = xx + width + 4, y0 = yy - 4, y1 = yy + height + 4;
        if (placedLabels.some(box => x0 < box.x1 && x1 > box.x0 && y0 < box.y1 && y1 > box.y0)) return true;
        if (yy > bottom) return false;
        if (rows.some((row, i) => x(i) >= x0 && x(i) <= x1 && y(row.high) <= y1 && y(row.low) >= y0)) return true;
        return [ma20, ma60, trendPoints].some(points => points.some(([px, py]) => px >= x0 && px <= x1 && py >= y0 && py <= y1));
      };
      let placement;
      for (const preferredSide of [true, false]) {
        for (let xx = right - width; xx >= left + 4 && !placement; xx -= 24) {
          const yy = positions.find(value => (!preferredSide || (item.role === 'support' ? value >= zoneEdge + 6 : value + height <= zoneEdge - 6)) && !overlaps(xx, value));
          if (yy !== undefined) placement = { xx, yy };
        }
        if (placement) break;
      }
      const { xx, yy } = placement || { xx: right - width, yy: item.role === 'support' ? bottom - height : top + 2 };
      placedLabels.push({ x0: xx - 4, x1: xx + width + 4, y0: yy - 4, y1: yy + height + 4 });
      const color = item.role === 'support' ? '#1e9b6e' : '#ae781b';
      const anchorX = xx + width / 2, anchorY = yy < zoneEdge ? yy + height : yy;
      const leader = Math.abs(anchorY - zoneEdge) > 40
        ? `<path d="M ${n(xx + width)} ${n(yy + height / 2)} H ${right + 3} V ${n(zoneEdge)} H ${right}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>`
        : `<line x1="${n(anchorX)}" y1="${n(anchorY)}" x2="${n(anchorX)}" y2="${n(zoneEdge)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      return `<g class="chart-zone-label">${leader}<rect x="${n(xx)}" y="${n(yy)}" width="${width}" height="${height}" rx="4" fill="#ffffff" fill-opacity=".94" stroke="${color}" stroke-opacity=".8"/><text x="${n(xx + 8)}" y="${n(yy + 15)}" fill="${color}" font-size="13" font-weight="700">${esc(label)}</text></g>`;
    }).join('');
    const body = `<g class="chart-axis">${grid}<line x1="${left}" y1="${volumeBottom}" x2="${right}" y2="${volumeBottom}" stroke="#304158"/>${dates}</g>${bands}${candles}${line(ma20, '#f3c76b', 2.5)}${line(ma60, '#8fc7ff', 2.5)}${trend}${zoneLabels}${legend}${hits}<line class="chart-crosshair" x1="0" y1="${top}" x2="0" y2="${volumeBottom}" stroke="#ffffff" stroke-width="1" opacity=".8" visibility="hidden" pointer-events="none"/>`;
    const last = rows.at(-1);
    return `<div class="chart-interactive"><div class="chart-readout" data-chart-readout>${esc(last.date)}　開 ${n(last.open)}　高 ${n(last.high)}　低 ${n(last.low)}　收 ${n(last.close)}　量 ${esc(last.volume)}</div>${svg('日K圖：最多120日支撐壓力區間、20及60日均線、最近60日回歸趨勢線與成交量', body, 445, 'technical-chart')}</div>`;
  }

  function sparkline(rows) {
    const values = rows.slice(-60).map(row => row.close);
    if (values.length < 2) return '';
    const [min, max] = bounds(values);
    const points = values.map((value, i) => [4 + i * 202 / (values.length - 1), 48 - (value - min) / (max - min) * 42]);
    const color = values.at(-1) >= values[0] ? '#e57479' : '#6bc7a0';
    return `<svg class="sparkline" viewBox="0 0 210 54" role="img" aria-label="最近60筆收盤走勢"><title>最近60筆收盤走勢</title>${line(points, color, 2.5)}</svg>`;
  }

  function equity(result, rows) {
    if (!result?.equity?.length) return '';
    const source = rows.slice(60), current = result.equity;
    const strategy = current.map(item => (item.value - 1) * 100);
    const hold = source.map(row => (row.close / source[0].open - 1) * 100);
    const rawMin = Math.min(...strategy, ...hold, 0), rawMax = Math.max(...strategy, ...hold, 0);
    const roughStep = Math.max((rawMax - rawMin) / 5, 0.01);
    const base = 10 ** Math.floor(Math.log10(roughStep));
    const step = [1, 2, 5, 10].map(factor => factor * base).reduce((best, value) => Math.abs(value - roughStep) < Math.abs(best - roughStep) ? value : best);
    const min = Math.floor(rawMin / step) * step, max = Math.max(min + step, Math.ceil(rawMax / step) * step);
    const left = 58, right = 840, top = 24, bottom = 265;
    const x = i => left + i * (right - left) / Math.max(1, current.length - 1);
    const y = value => bottom - (value - min) / (max - min) * (bottom - top);
    const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
    const grid = ticks.map(value => `<line x1="${left}" y1="${n(y(value))}" x2="${right}" y2="${n(y(value))}" stroke="${Math.abs(value) < step / 10 ? '#71849c' : '#304158'}" stroke-dasharray="3 5"/><text x="46" y="${n(y(value) + 4)}" text-anchor="end">${Math.round(value * 100) / 100}%</text>`).join('');
    const hits = current.map((item, i) => `<rect class="chart-hit" data-chart-point="equity" data-date="${esc(item.date)}" data-strategy="${n(strategy[i])}" data-hold="${n(hold[i])}" data-x="${n(x(i))}" x="${n(x(i) - (right - left) / current.length / 2)}" y="${top}" width="${n((right - left) / current.length)}" height="${bottom - top}" fill="transparent" tabindex="0" aria-label="${esc(`${item.date} 策略 ${n(strategy[i])}% 買入持有 ${n(hold[i])}%`)}"/>`).join('');
    const body = `<g class="chart-axis">${grid}<text x="${left}" y="293">${esc(current[0].date)}</text><text x="${right}" y="293" text-anchor="end">${esc(current.at(-1).date)}</text></g>${line(strategy.map((value, i) => [x(i), y(value)]), '#f3c76b', 3)}${line(hold.map((value, i) => [x(i), y(value)]), '#4db8ff', 3, 'stroke-dasharray="7 4"')}${hits}<line class="chart-crosshair" x1="0" y1="${top}" x2="0" y2="${bottom}" stroke="#ffffff" stroke-width="1" opacity=".8" visibility="hidden" pointer-events="none"/>`;
    return `<div class="chart-interactive"><div class="chart-keys"><span><i class="key-strategy"></i> 金色實線：策略，期末 ${n(strategy.at(-1))}%</span><span><i class="key-hold"></i> 藍色虛線：買入持有，期末 ${n(hold.at(-1))}%</span></div><p class="chart-axis-note">縱軸：從初始資金起算的累積報酬；0% 為起點。軸刻度只是讀圖參考。</p><div class="chart-readout" data-chart-readout>${esc(current.at(-1).date)}　策略 ${n(strategy.at(-1))}%　買入持有 ${n(hold.at(-1))}%</div>${svg('策略與買入持有累積報酬比較', body, 305)}</div>`;
  }

  function allocation(items) {
    const valid = items.filter(item => item.weight !== null).slice(0, 8);
    if (!valid.length) return '';
    const rows = valid.map((item, i) => {
      const y = 30 + i * 39, width = Math.max(0, Math.min(620, item.weight / 100 * 620));
      return `<text x="22" y="${y + 15}">${esc(item.ticker)}</text><rect x="145" y="${y}" width="620" height="18" rx="4" fill="#23344d"/><rect x="145" y="${y}" width="${n(width)}" height="18" rx="4" fill="#d7a94e"/><text x="775" y="${y + 15}">${n(item.weight)}%</text>`;
    }).join('');
    return svg('組合持股權重長條圖', `<g class="chart-axis">${rows}</g>`, 45 + valid.length * 39);
  }

  function outcomes(recent) {
    const valid = recent.filter(item => item.day1 !== null || item.day5 !== null).slice(0, 20).reverse();
    if (!valid.length) return '';
    const all = valid.flatMap(item => [item.day1, item.day5]).filter(Number.isFinite);
    const largest = Math.max(1, ...all.map(Math.abs));
    const scale = Math.max(5, Math.ceil(largest / 5) * 5);
    const signed = value => `${value > 0 ? '+' : ''}${n(value)}%`;
    const measure = (value, label, kind) => {
      if (value === null) return `<div class="outcome-measure"><span>${label}</span><div class="outcome-track"></div><strong>資料不足</strong></div>`;
      const width = Math.min(50, Math.abs(value) / scale * 50);
      const left = value >= 0 ? 50 : 50 - width;
      return `<div class="outcome-measure"><span>${label}</span><div class="outcome-track"><i class="outcome-bar ${kind}" style="left:${n(left)}%;width:${n(width)}%"></i></div><strong class="${value < 0 ? 'negative' : 'positive'}">${signed(value)}</strong></div>`;
    };
    const rows = valid.map((item, index) => `<div class="outcome-row"><div class="outcome-label">第 ${index + 1} 筆 · ${esc(item.date)} · ${esc(item.ticker)} · ${item.side === 'sell' ? '賣出' : '買入'}</div>${measure(item.day1, '1日', 'day1')}${measure(item.day5, '5日', 'day5')}</div>`).join('');
    return `<div class="chart-keys"><span><i class="key-day1"></i> 藍色：1 個交易日後</span><span><i class="key-day5"></i> 橘色：5 個交易日後</span></div><div class="outcome-chart" role="img" aria-label="每筆已記錄交易之後1日與5日相對價格變動"><div class="outcome-axis-title">相對價格變動（%）· 每列是一筆已記錄交易</div><div class="outcome-axis"><span>-${scale}%</span><span>-${scale / 2}%</span><span>0%</span><span>+${scale / 2}%</span><span>+${scale}%</span></div>${rows}</div>`;
  }

  return { candlestick, sparkline, equity, allocation, outcomes };
});
