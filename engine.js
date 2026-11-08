(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ResearchEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
  const dateOnly = value => String(value || '').slice(0, 10);

  function positions(data) {
    if (!data || !Array.isArray(data.dca) || !Array.isArray(data.direct)) throw new Error('投資組合資料格式不符');
    return [...data.dca.map(item => ({ ...item, source: 'dca' })), ...data.direct.map(item => ({ ...item, source: 'direct' }))]
      .filter(item => /^[0-9A-Z]{4,8}$/.test(String(item.ticker || '')));
  }

  function trades(data) {
    return positions(data).flatMap(position => {
      const source = position.source === 'dca' ? position.entries : position.transactions;
      return (Array.isArray(source) ? source : []).filter(item => item.type !== 'skipped').map(item => ({
        id: item.id, ticker: position.ticker, name: position.name || position.ticker,
        date: dateOnly(item.date), side: item.type === 'sell' ? 'sell' : 'buy',
        shares: number(item.shares), price: number(item.pricePerShare ?? item.costPerShare),
        amount: number(item.amount ?? item.totalCost), notes: String(item.notes || '').trim()
      }));
    }).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.shares > 0 && item.price > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function holdings(data) {
    const byTicker = new Map();
    for (const trade of trades(data)) {
      const item = byTicker.get(trade.ticker) || { ticker: trade.ticker, name: trade.name, shares: 0, lots: [], realized: 0 };
      if (trade.side === 'buy') {
        item.lots.push({ shares: trade.shares, price: trade.price });
        item.shares += trade.shares;
      } else {
        let remaining = trade.shares;
        while (remaining > 0 && item.lots.length) {
          const lot = item.lots[0];
          const used = Math.min(lot.shares, remaining);
          item.realized += used * (trade.price - lot.price);
          lot.shares -= used;
          item.shares -= used;
          remaining -= used;
          if (lot.shares < 1e-8) item.lots.shift();
        }
      }
      byTicker.set(trade.ticker, item);
    }
    return [...byTicker.values()].filter(item => item.shares > 1e-8).map(item => ({
      ticker: item.ticker, name: item.name, shares: round(item.shares, 4),
      cost: round(item.lots.reduce((sum, lot) => sum + lot.shares * lot.price, 0)),
      realized: round(item.realized)
    }));
  }

  function candles(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map(row => ({ date: dateOnly(row.date), open: number(row.open), high: number(row.high), low: number(row.low), close: number(row.close), volume: number(row.volume) }))
      .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
  function sma(rows, period, end = rows.length) { return end >= period ? mean(rows.slice(end - period, end).map(row => row.close)) : null; }
  function rsi(rows, period = 14) {
    if (rows.length <= period) return null;
    let gains = 0, losses = 0;
    for (let i = rows.length - period; i < rows.length; i++) {
      const delta = rows[i].close - rows[i - 1].close;
      gains += Math.max(delta, 0); losses += Math.max(-delta, 0);
    }
    return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }
  function atr(rows, period = 14) {
    if (rows.length <= period) return null;
    const ranges = [];
    for (let i = rows.length - period; i < rows.length; i++) {
      const row = rows[i], prior = rows[i - 1].close;
      ranges.push(Math.max(row.high - row.low, Math.abs(row.high - prior), Math.abs(row.low - prior)));
    }
    return mean(ranges);
  }

  // These cutoffs make the video's discretionary price-action principles reproducible.
  const SR = { history: 120, flank: 3, reactionDays: 8, minReaction: 1.5, groupGap: 0.75,
    zonePad: 0.35, consolidationDays: [30, 25, 20, 15], acceptanceDays: 3, retestDays: 3 };
  const atrAt = (rows, index) => atr(rows.slice(0, index + 1));

  function swingCandidates(rows) {
    const turns = [];
    for (let i = Math.max(17, rows.length - SR.history); i <= rows.length - SR.reactionDays - 1; i++) {
      const before = rows.slice(i - SR.flank, i), after = rows.slice(i + 1, i + SR.flank + 1);
      const later = rows.slice(i + 1, i + SR.reactionDays + 1), volatility = atrAt(rows, i);
      if (!volatility) continue;
      const high = rows[i].high, low = rows[i].low;
      const falling = (rows[i].close - Math.min(...later.map(row => row.close))) / volatility;
      const rising = (Math.max(...later.map(row => row.close)) - rows[i].close) / volatility;
      if (before.every(row => high > row.high) && after.every(row => high > row.high) &&
          rows[i].close - rows[i - SR.flank].close >= volatility * 0.75 && falling >= SR.minReaction) {
        turns.push({ side: 'resistance', level: high, atr: volatility, reaction: falling, index: i, formedIndex: i + SR.reactionDays, date: rows[i].date });
      }
      if (before.every(row => low < row.low) && after.every(row => low < row.low) &&
          rows[i - SR.flank].close - rows[i].close >= volatility * 0.75 && rising >= SR.minReaction) {
        turns.push({ side: 'support', level: low, atr: volatility, reaction: rising, index: i, formedIndex: i + SR.reactionDays, date: rows[i].date });
      }
    }
    return turns;
  }

  function groupedSwings(turns) {
    const zones = [];
    for (const side of ['support', 'resistance']) {
      const groups = [];
      for (const turn of turns.filter(item => item.side === side).sort((a, b) => a.level - b.level)) {
        const group = groups.at(-1), first = group?.[0];
        if (first && turn.level - first.level <= SR.groupGap * Math.min(first.atr, turn.atr)) group.push(turn);
        else groups.push([turn]);
      }
      for (const group of groups) {
        const sortedAtr = group.map(item => item.atr).sort((a, b) => a - b);
        const volatility = sortedAtr[Math.floor((sortedAtr.length - 1) / 2)];
        const strongest = group.reduce((best, item) => item.reaction > best.reaction ? item : best);
        zones.push({ source: '轉折', side, low: Math.max(0.01, group[0].level - volatility * SR.zonePad),
          high: group.at(-1).level + volatility * SR.zonePad, atr: volatility, reaction: strongest.reaction,
          score: Math.min(strongest.reaction, 5), turns: group.length, formedIndex: Math.min(...group.map(item => item.formedIndex)), date: strongest.date });
      }
    }
    return zones;
  }

  function consolidationCandidates(rows) {
    const candidates = [], first = Math.max(14, rows.length - SR.history);
    for (let end = first + 14; end <= rows.length - SR.reactionDays - 1; end++) {
      const volatility = atrAt(rows, end);
      if (!volatility) continue;
      for (const duration of SR.consolidationDays) {
        const start = end - duration + 1;
        if (start < first) continue;
        const window = rows.slice(start, end + 1);
        const low = Math.min(...window.map(row => row.low)), high = Math.max(...window.map(row => row.high));
        if (high - low > volatility * 3 || Math.abs(rows[end].close - rows[start].close) > volatility * 1.25) continue;
        const later = rows.slice(end + 1, end + SR.reactionDays + 1);
        const up = later.some((row, i) => i && row.close > high + volatility * 0.25 && later[i - 1].close > high + volatility * 0.25);
        const down = later.some((row, i) => i && row.close < low - volatility * 0.25 && later[i - 1].close < low - volatility * 0.25);
        const upwardMove = (Math.max(...later.map(row => row.close)) - high) / volatility;
        const downwardMove = (low - Math.min(...later.map(row => row.close))) / volatility;
        if ((!up || upwardMove < 1) && (!down || downwardMove < 1)) continue;
        const side = up && upwardMove >= downwardMove ? 'support' : 'resistance';
        const reaction = side === 'support' ? upwardMove : downwardMove;
        const priorVolume = mean(rows.slice(Math.max(0, start - 20), start).map(row => row.volume));
        const currentVolume = mean(window.map(row => row.volume));
        candidates.push({ source: '盤整', side, low, high, atr: volatility, reaction,
          score: Math.min(reaction, 4) + duration / 15, turns: 0, duration, volumeRatio: priorVolume ? currentVolume / priorVolume : null,
          formedIndex: end + SR.reactionDays, date: `${rows[start].date}–${rows[end].date}` });
        break; // Prefer the longest qualifying window at this endpoint.
      }
    }
    return candidates;
  }

  function distinctZones(candidates) {
    const result = [];
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      const similar = result.find(item => item.side === candidate.side &&
        Math.abs((item.low + item.high - candidate.low - candidate.high) / 2) <= Math.min(item.atr, candidate.atr) * 0.75 &&
        Math.min(item.high, candidate.high) >= Math.max(item.low, candidate.low));
      if (similar) {
        if (similar.source !== candidate.source && !similar.source.includes(candidate.source)) similar.source += `＋${candidate.source}`;
      } else result.push(candidate);
    }
    return result;
  }

  function reactionEvidence(rows, zone, lastIndex) {
    const values = [], side = zone.side;
    let lastTouch = -10;
    for (let i = zone.formedIndex + 1; i + 5 <= lastIndex; i++) {
      const prior = rows[i - 1], row = rows[i], volatility = atrAt(rows, i) || zone.atr;
      const approached = side === 'support' ? prior.close > zone.high + volatility * 0.2 : prior.close < zone.low - volatility * 0.2;
      if (!approached || i - lastTouch < 6 || row.low > zone.high || row.high < zone.low) continue;
      const later = rows.slice(i + 1, i + 6).map(item => item.close);
      values.push(Math.max(0, side === 'support' ? (Math.max(...later) - zone.high) / volatility : (zone.low - Math.min(...later)) / volatility));
      lastTouch = i;
    }
    const last = values.slice(-3);
    const rising = last.length === 3 && last[1] - last[0] >= 0.2 && last[2] - last[1] >= 0.2 && last[2] - last[0] >= 0.75;
    const falling = last.length === 3 && last[0] - last[1] >= 0.2 && last[1] - last[2] >= 0.2 && last[0] - last[2] >= 0.75;
    return { tests: values.length, reactionTrend: rising ? '轉強' : falling ? '轉弱' : '證據不足或無一致趨勢' };
  }

  function zoneState(rows, zone) {
    let phase = 'candidate', role = zone.side, streak = 0, acceptedAt = -1, retestAt = -1, failedAt = -1;
    let confirmedAt = rows.length, volumeRatio = null;
    for (let i = zone.formedIndex + 1; i < rows.length; i++) {
      const row = rows[i], tolerance = zone.atr * 0.1;
      const beyond = role === 'resistance' ? row.close > zone.high + tolerance : row.close < zone.low - tolerance;
      const wrongSide = role === 'resistance' ? row.close < zone.low - tolerance : row.close > zone.high + tolerance;
      const touched = row.low <= zone.high + zone.atr * 0.2 && row.high >= zone.low - zone.atr * 0.2;
      if (phase === 'candidate' || phase === 'failed') {
        if (beyond) {
          phase = 'breaking'; streak = 1;
          const priorVolume = mean(rows.slice(Math.max(0, i - 20), i).map(item => item.volume));
          volumeRatio = role === 'resistance' && priorVolume ? row.volume / priorVolume : null;
        }
      } else if (phase === 'breaking') {
        if (beyond && ++streak >= SR.acceptanceDays) { phase = 'accepted'; acceptedAt = i; }
        else if (!beyond) { phase = 'failed'; failedAt = i; }
      } else if (phase === 'accepted' || phase === 'retesting') {
        if (wrongSide) { phase = 'failed'; failedAt = i; }
        else if (phase === 'retesting' && beyond && i > retestAt && i - retestAt <= SR.retestDays) {
          phase = 'confirmed'; confirmedAt = i; role = role === 'support' ? 'resistance' : 'support';
        } else if (phase === 'retesting' && i - retestAt > SR.retestDays) phase = 'accepted';
        else if (touched && phase === 'accepted') { phase = 'retesting'; retestAt = i; }
      } else if (phase === 'confirmed') {
        const lost = role === 'support' ? row.close < zone.low - tolerance : row.close > zone.high + tolerance;
        if (lost) phase = 'invalid';
      }
    }
    const close = rows.at(-1).close, distance = close < zone.low ? zone.low - close : close > zone.high ? close - zone.high : 0;
    const inside = close >= zone.low && close <= zone.high;
    const location = inside ? '區內' : distance <= zone.atr * 0.75 ? '接近' : '區外';
    const status = phase === 'confirmed' ? '角色互換已確認' : phase === 'invalid' ? '互換後失效' :
      phase === 'breaking' ? (zone.side === 'resistance' ? '突破未確認' : '跌破未確認') :
      phase === 'accepted' ? (acceptedAt === rows.length - 1 ? '區外站穩' : '等待回測') :
      phase === 'retesting' ? '回測中' : phase === 'failed' && rows.length - 1 - failedAt <= 10 ? '突破／跌破失敗' :
      inside ? '區內觀察' : distance <= zone.atr * 0.75 ? '接近區間' : '候選區間';
    return { ...zone, role, status, location, distance, volumeRatioBreak: volumeRatio,
      ...reactionEvidence(rows, zone, confirmedAt - 1) };
  }

  function horizontalZones(rows) {
    if (rows.length < 61) return [];
    const volatility = atrAt(rows, rows.length - 2);
    if (!volatility) return [];
    const candidates = distinctZones([...groupedSwings(swingCandidates(rows)), ...consolidationCandidates(rows)]);
    const ranked = candidates.map(item => zoneState(rows, item)).filter(item => item.status !== '互換後失效' && item.distance <= volatility * 8)
      .map(item => ({ ...item, rank: item.score + (1 - Math.min(120, rows.length - item.formedIndex) / 120) * 0.5 - item.distance / volatility * 0.3 + (item.status === '角色互換已確認' ? 0.5 : 0) }))
      .sort((a, b) => b.rank - a.rank);
    const selected = [];
    const active = ranked.find(item => item.distance === 0 || item.status === '接近區間' || item.status === '回測中' ||
      (item.status === '角色互換已確認' && item.distance <= item.atr * 2));
    if (active) selected.push(active);
    for (const side of active ? [active.role === 'support' ? 'resistance' : 'support'] : ['support', 'resistance']) {
      const item = ranked.find(candidate => candidate.role === side && !selected.includes(candidate));
      if (item && selected.length < 2) selected.push(item);
    }
    return selected.map(item => ({ ...item, low: round(item.low), high: round(item.high), reaction: round(item.reaction),
      rank: round(item.rank), volumeRatio: round(item.volumeRatio), volumeRatioBreak: round(item.volumeRatioBreak) }));
  }

  function technical(rows) {
    if (rows.length < 61) return null;
    const last = rows.at(-1), fast = sma(rows, 20), slow = sma(rows, 60);
    const prior20 = rows.slice(-21, -1);
    const high20 = Math.max(...prior20.map(row => row.high));
    const low20 = Math.min(...prior20.map(row => row.low));
    const avgVolume = mean(rows.slice(-21, -1).map(row => row.volume));
    const momentum = rows.at(-21)?.close ? last.close / rows.at(-21).close - 1 : 0;
    const range = atr(rows);
    const srZones = horizontalZones(rows);
    const support = srZones.find(item => item.role === 'support');
    const resistance = srZones.find(item => item.role === 'resistance');
    const score = (last.close > fast ? 1 : 0) + (fast > slow ? 1 : 0) + (momentum > 0 ? 1 : 0) + (avgVolume && last.volume > avgVolume ? 1 : 0);
    const risk = range ? Math.max(range * 1.5, last.close * 0.03) : null;
    return {
      date: last.date, close: last.close, ma20: round(fast), ma60: round(slow),
      rsi14: round(rsi(rows)), atr14: round(range), high20: round(high20), low20: round(low20),
      supportLow: support?.low ?? null, supportHigh: support?.high ?? null, supportTurns: support?.turns || 0,
      resistanceLow: resistance?.low ?? null, resistanceHigh: resistance?.high ?? null, resistanceTurns: resistance?.turns || 0,
      srZones,
      volumeRatio: avgVolume ? round(last.volume / avgVolume) : null,
      momentum20: round(momentum * 100), score,
      state: score >= 3 ? '觀察候選' : score === 2 ? '等待確認' : '暫不符合',
      trigger: round(high20), stop: risk ? round(last.close - risk) : null,
      target: risk ? round(last.close + risk * 2) : null,
      reasons: [last.close > fast ? '收盤價高於20日均線' : '收盤價低於20日均線', fast > slow ? '20日均線高於60日均線' : '20日均線未高於60日均線', momentum > 0 ? '20日動能為正' : '20日動能未轉正', avgVolume && last.volume > avgVolume ? '成交量高於前20日平均' : '成交量未高於前20日平均']
    };
  }

  function weeklyTrend(rows, asOf) {
    const weekKey = date => {
      const value = new Date(`${date}T00:00:00Z`);
      value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
      return value.toISOString().slice(0, 10);
    };
    const weeks = [];
    for (const row of rows) {
      const key = weekKey(row.date);
      if (weeks.at(-1)?.key === key) weeks[weeks.length - 1] = { key, date: row.date, close: row.close };
      else weeks.push({ key, date: row.date, close: row.close });
    }
    const today = String(asOf || '');
    const day = today ? new Date(`${today}T00:00:00Z`).getUTCDay() : 0;
    if (weeks.length && today && weeks.at(-1).key === weekKey(today) && day >= 1 && day <= 5) weeks.pop();
    if (weeks.length < 30) return null;
    const fast = mean(weeks.slice(-10).map(week => week.close));
    const slow = mean(weeks.slice(-30).map(week => week.close));
    return { date: weeks.at(-1).date, close: weeks.at(-1).close, ma10: round(fast), ma30: round(slow), state: fast > slow ? '週線偏強' : '週線偏弱' };
  }

  function backtest(rows, costPerSide = 0.0025) {
    if (rows.length < 90) return null;
    let cash = 1, shares = 0, entry = null, peak = 1, peakDate = rows[60].date, maxDrawdown = 0;
    let drawdownPeak = { date: peakDate, value: peak }, drawdownTrough = null;
    const trades = [], equity = [];
    for (let i = 60; i < rows.length; i++) {
      const prior = i - 1;
      const fast = sma(rows, 20, i), slow = sma(rows, 60, i);
      const priorFast = sma(rows, 20, prior), priorSlow = sma(rows, 60, prior);
      if (priorFast !== null && priorSlow !== null) {
        if (!shares && priorFast <= priorSlow && fast > slow) {
          shares = cash * (1 - costPerSide) / rows[i].open;
          entry = { date: rows[i].date, price: rows[i].open, value: cash };
          cash = 0;
        } else if (shares && priorFast >= priorSlow && fast < slow) {
          cash = shares * rows[i].open * (1 - costPerSide);
          trades.push({ entryDate: entry.date, exitDate: rows[i].date, returnPct: round((cash / entry.value - 1) * 100) });
          shares = 0; entry = null;
        }
      }
      const value = cash + shares * rows[i].close;
      if (value > peak) { peak = value; peakDate = rows[i].date; }
      const drawdown = value / peak - 1;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
        drawdownPeak = { date: peakDate, value: round(peak, 6) };
        drawdownTrough = { date: rows[i].date, value: round(value, 6) };
      }
      equity.push({ date: rows[i].date, value });
    }
    const finalValue = equity.at(-1)?.value || 1;
    return { start: rows[60].date, end: rows.at(-1).date, trades: trades.length,
      openPosition: !!shares, winRate: trades.length ? round(trades.filter(item => item.returnPct > 0).length / trades.length * 100) : null,
      avgTrade: trades.length ? round(mean(trades.map(item => item.returnPct))) : null,
      totalReturn: round((finalValue - 1) * 100), finalEquity: round(finalValue, 6),
      maxDrawdown: round(maxDrawdown * 100), drawdownPeak, drawdownTrough,
      buyHold: round((rows.at(-1).close / rows[60].open - 1) * 100),
      costPerSide: round(costPerSide * 100), tradeRows: trades, equity };
  }

  function returns(rows) {
    const map = new Map();
    for (let i = 1; i < rows.length; i++) map.set(rows[i].date, rows[i].close / rows[i - 1].close - 1);
    return map;
  }
  function beta(rows, benchmark) {
    if (!rows || !benchmark) return null;
    const stock = returns(rows), market = returns(benchmark);
    const pairs = [...stock].filter(([date]) => market.has(date)).slice(-90).map(([date, value]) => [value, market.get(date)]);
    if (pairs.length < 40) return null;
    const x = mean(pairs.map(pair => pair[1])), y = mean(pairs.map(pair => pair[0]));
    const variance = pairs.reduce((sum, pair) => sum + (pair[1] - x) ** 2, 0);
    return variance > 0 ? pairs.reduce((sum, pair) => sum + (pair[1] - x) * (pair[0] - y), 0) / variance : null;
  }

  function correlation(first, second) {
    if (!first || !second) return null;
    const a = returns(first), b = returns(second);
    const pairs = [...a].filter(([date]) => b.has(date)).slice(-90).map(([date, value]) => [value, b.get(date)]);
    if (pairs.length < 40) return null;
    const x = mean(pairs.map(pair => pair[0])), y = mean(pairs.map(pair => pair[1]));
    const covariance = pairs.reduce((sum, pair) => sum + (pair[0] - x) * (pair[1] - y), 0);
    const sx = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - x) ** 2, 0));
    const sy = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[1] - y) ** 2, 0));
    return sx && sy ? covariance / (sx * sy) : null;
  }

  function portfolioRisk(data, history) {
    const items = holdings(data).map(item => {
      const rows = history[item.ticker] || [];
      const last = rows.at(-1);
      const value = last ? item.shares * last.close : null;
      return { ...item, price: last?.close ?? null, date: last?.date ?? null, value: value === null ? null : round(value), beta: round(beta(rows, history.IX0001)) };
    });
    const total = items.reduce((sum, item) => sum + (item.value || 0), 0);
    items.forEach(item => { item.weight = item.value !== null && total ? round(item.value / total * 100) : null; item.shockLoss = item.value !== null && item.beta !== null ? round(item.value * item.beta * -0.2) : null; });
    const estimatedLoss = items.every(item => item.shockLoss !== null) && items.length ? round(items.reduce((sum, item) => sum + item.shockLoss, 0)) : null;
    const pairs = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const value = correlation(history[items[i].ticker], history[items[j].ticker]);
      if (value !== null) pairs.push({ first: items[i].ticker, second: items[j].ticker, value: round(value) });
    }
    return { items: items.sort((a, b) => (b.value || 0) - (a.value || 0)), total: round(total), largestWeight: items.length ? Math.max(...items.map(item => item.weight || 0)) : 0, estimatedLoss, coverage: items.filter(item => item.value !== null).length, betaCoverage: items.filter(item => item.beta !== null).length, pairs: pairs.sort((a, b) => b.value - a.value) };
  }

  function selectTrades(data, options = {}, sourceTrades = null) {
    const all = sourceTrades || trades(data);
    const filtered = all.filter(item =>
      (!options.from || item.date >= options.from) &&
      (!options.to || item.date <= options.to) &&
      (!options.ticker || item.ticker === options.ticker) &&
      (!options.side || item.side === options.side)
    ).reverse();
    const pageSize = 20;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.trunc(Number(options.page) || 1)));
    return { total: all.length, filteredTotal: filtered.length, page, pageCount,
      items: filtered.slice((page - 1) * pageSize, page * pageSize) };
  }

  function journal(data, history, options = {}) {
    const all = trades(data), selection = selectTrades(data, options, all), recent = selection.items;
    const lots = new Map(), realizedByTrade = new Map();
    for (const trade of all) {
      const queue = lots.get(trade.ticker) || [];
      if (trade.side === 'buy') queue.push({ shares: trade.shares, price: trade.price });
      else {
        let remaining = trade.shares, realized = 0;
        while (remaining > 0 && queue.length) {
          const lot = queue[0], used = Math.min(remaining, lot.shares);
          realized += used * (trade.price - lot.price);
          lot.shares -= used; remaining -= used;
          if (lot.shares < 1e-8) queue.shift();
        }
        realizedByTrade.set(trade, remaining > 1e-8 ? null : round(realized));
      }
      lots.set(trade.ticker, queue);
    }
    const outcome = recent.map(trade => {
      const rows = (history[trade.ticker] || []).filter(row => row.date > trade.date);
      const pct = days => rows.length >= days ? round((rows[days - 1].close / trade.price - 1) * 100 * (trade.side === 'sell' ? -1 : 1)) : null;
      return { ...trade, day1: pct(1), day3: pct(3), day5: pct(5), realized: realizedByTrade.get(trade) ?? null };
    });
    const evaluated = outcome.filter(item => item.day5 !== null);
    return { total: all.length, filteredTotal: selection.filteredTotal, page: selection.page,
      pageCount: selection.pageCount, recent: outcome, notes: recent.filter(item => item.notes).length,
      buys: recent.filter(item => item.side === 'buy').length, sells: recent.filter(item => item.side === 'sell').length,
      avgDay5: evaluated.length ? round(mean(evaluated.map(item => item.day5))) : null,
      evaluated: evaluated.length, realized: round(outcome.reduce((sum, item) => sum + (item.realized || 0), 0)), closed: outcome.filter(item => item.realized !== null).length };
  }

  return { positions, trades, selectTrades, holdings, candles, technical, horizontalZones, weeklyTrend, backtest, beta, correlation, portfolioRisk, journal };
});
