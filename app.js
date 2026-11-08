(function () {
  'use strict';
  const Engine = window.ResearchEngine;
  const Charts = window.ResearchCharts;
  const PORTFOLIO_URL = 'https://raw.githubusercontent.com/dksbluesky/ETF_DCA-plan/main/portfolio-data.json';
  const FUGLE_BASE = 'https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/';
  const KEY_STORAGE = 'twResearchDesk.fugleKey.v1';
  const STARTERS = [
    ['0050', '元大台灣50'], ['006208', '富邦台50'], ['00878', '國泰永續高股息'], ['0056', '元大高股息'],
    ['2330', '台積電'], ['2317', '鴻海'], ['2454', '聯發科'], ['2308', '台達電'], ['2881', '富邦金'], ['2882', '國泰金']
  ];
  const TITLES = {
    ideas: ['今日機會', '固定台股入門清單，加上 ETF_DCA-plan 持股。'],
    technical: ['技術分析', '日K趨勢、動能、量能、參考價位與判讀理由。'],
    backtest: ['策略回測', '20/60 日均線交叉，訊號次一交易日開盤執行。'],
    risk: ['組合風險', '以 ETF_DCA-plan 持股計算權重與大盤下跌情境。'],
    journal: ['交易檢討', '篩選 ETF_DCA-plan 的全部交易紀錄，每頁檢視 20 筆。']
  };
  let activeTab = 'ideas';
  let journalPage = 1;
  let portfolio = null;
  let portfolioError = '';
  const historyCache = new Map();
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fmt = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '資料不足' : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits });
  const pct = value => value === null || value === undefined ? '資料不足' : `${value > 0 ? '+' : ''}${fmt(value)}%`;
  const cls = value => value > 0 ? 'positive' : value < 0 ? 'negative' : '';
  const daysAgo = days => { const date = new Date(); date.setDate(date.getDate() - days); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); };
  const today = () => daysAgo(0);
  const note = text => `<p class="source-note">${escape(text)}</p>`;
  const card = (title, value, detail = '') => `<div class="card"><h3>${escape(title)}</h3><div class="metric">${escape(value)}</div><p>${escape(detail)}</p></div>`;
  const panel = (title, body) => `<section class="panel"><h3>${escape(title)}</h3>${body}</section>`;

  function setMessage(message, error = false) {
    $('message').textContent = message;
    $('message').classList.toggle('error', error);
  }
  function setSourceStatus() {
    const key = localStorage.getItem(KEY_STORAGE);
    $('source-status').textContent = `${portfolio ? '持股已連接' : '持股未連接'} · ${key ? 'Fugle 已設定' : 'Fugle 未設定'}`;
  }
  async function loadPortfolio() {
    try {
      const response = await fetch(PORTFOLIO_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const data = await response.json();
      Engine.positions(data);
      portfolio = data;
      portfolioError = '';
    } catch (error) {
      portfolio = null;
      portfolioError = String(error.message || error);
    }
    setSourceStatus();
    populateSymbols();
    populateJournalTickers();
  }
  function symbolList() {
    const names = new Map(STARTERS);
    if (portfolio) for (const item of Engine.positions(portfolio)) names.set(item.ticker, item.name || item.ticker);
    return [...names].map(([ticker, name]) => ({ ticker, name }));
  }
  function populateSymbols() {
    const select = $('symbol-select'), selected = select.value;
    select.replaceChildren();
    for (const item of symbolList()) {
      const option = document.createElement('option');
      option.value = item.ticker;
      option.textContent = `${item.ticker} ${item.name}`;
      select.append(option);
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }
  function populateJournalTickers() {
    const select = $('journal-ticker'), selected = select.value;
    select.replaceChildren(new Option('全部標的', ''));
    if (portfolio) for (const ticker of [...new Set(Engine.trades(portfolio).map(item => item.ticker))].sort()) {
      select.add(new Option(ticker, ticker));
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
  }
  function journalOptions() {
    const from = $('journal-from').value, to = $('journal-to').value;
    if (from && to && from > to) throw new Error('起始日期不可晚於結束日期');
    return { from, to, ticker: $('journal-ticker').value, side: $('journal-side').value, page: journalPage };
  }
  function updateJournalPager(result) {
    journalPage = result.page;
    $('journal-pager').hidden = false;
    $('journal-page-status').textContent = `第 ${result.page} / ${result.pageCount} 頁 · 符合 ${result.filteredTotal} 筆（全部 ${result.total} 筆）`;
    $('journal-prev').disabled = result.page <= 1;
    $('journal-next').disabled = result.page >= result.pageCount;
  }
  async function getHistory(ticker) {
    const key = localStorage.getItem(KEY_STORAGE);
    if (!key) throw new Error('請先在設定輸入 Fugle API Key');
    const cached = historyCache.get(ticker);
    if (cached && Date.now() - cached.time < 15 * 60 * 1000) return cached.rows;
    const query = new URLSearchParams({ timeframe: 'D', from: daysAgo(350), to: today(), adjusted: 'true', sort: 'asc' });
    const response = await fetch(`${FUGLE_BASE}${encodeURIComponent(ticker)}?${query}`, { headers: { 'X-API-KEY': key }, cache: 'no-store' });
    if (!response.ok) throw new Error(`${ticker} Fugle HTTP ${response.status}`);
    const rows = Engine.candles(await response.json());
    if (!rows.length) throw new Error(`${ticker} 無可用日K資料`);
    if (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${rows.at(-1).date}T00:00:00Z`) > 10 * 86400000) throw new Error(`${ticker} 日K資料過期（${rows.at(-1).date}）`);
    historyCache.set(ticker, { time: Date.now(), rows });
    return rows;
  }
  async function getMany(symbols) {
    const history = {}, errors = [];
    let next = 0;
    async function worker() {
      while (next < symbols.length) {
        const symbol = symbols[next++];
        try { history[symbol] = await getHistory(symbol); }
        catch (error) { errors.push(String(error.message || error)); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, symbols.length) }, worker));
    return { history, errors };
  }
  function freshness(history) {
    const dates = Object.values(history).map(rows => rows.at(-1)?.date).filter(Boolean);
    return dates.length ? `Fugle 還原日K · 最新資料 ${dates.sort().at(-1)} · 各標的日期可能不同` : '無 Fugle 日K';
  }
  function failureNote(errors) { return errors.length ? panel('未取得的資料', `<p class="warning">${escape(errors.join('；'))}</p>`) : ''; }

  function ideasView(history, errors) {
    const names = new Map(symbolList().map(item => [item.ticker, item.name]));
    const scored = Object.entries(history).map(([ticker, rows]) => ({ ticker, name: names.get(ticker) || ticker, result: Engine.technical(rows) }))
      .filter(item => item.result).sort((a, b) => b.result.score - a.result.score || (b.result.momentum20 || 0) - (a.result.momentum20 || 0));
    const top = scored.slice(0, 5);
    const cards = top.map(({ ticker, name, result }) => {
      const tagClass = result.score >= 3 ? '' : result.score === 2 ? 'wait' : 'avoid';
      return panel(`${ticker} ${name}`, `<div class="idea"><div><span class="tag ${tagClass}">${escape(result.state)} · ${result.score}/4</span><div class="numbers"><span>收盤 ${fmt(result.close)}</span><span>20日動能 ${pct(result.momentum20)}</span><span>量比 ${fmt(result.volumeRatio)}×</span><span>突破觀察 ${fmt(result.trigger)}</span></div><p class="subtle">${escape(result.date)} · 參考停損 ${fmt(result.stop)} · 參考目標 ${fmt(result.target)}</p></div></div>${Charts.sparkline(history[ticker])}<ul class="reason-list">${result.reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul>`);
    }).join('');
    return `<div class="cards">${card('篩選標的', String(scored.length), '有足夠日K可計算')}${card('符合 3 項以上', String(scored.filter(item => item.result.score >= 3).length), '只是研究候選，不代表勝率')}${card('最高評分', top.length ? `${top[0].ticker} · ${top[0].result.score}/4` : '資料不足', '規則透明、按分數排序')}</div>${panel('篩選規則', '<p>固定入門清單加上既有持股。四項各一分：收盤高於20日均線、20日均線高於60日均線、20日動能為正、當日量高於前20日平均。突破觀察價取前20個交易日高點（不含最新一日）；停損與目標按 ATR 推算，僅供情境研究。</p>')}${cards || panel('尚無結果', '<p>沒有足夠行情可產生候選。</p>')}${failureNote(errors)}${note(freshness(history))}`;
  }
  function technicalView(ticker, rows) {
    const result = Engine.technical(rows);
    if (!result) return panel('資料不足', '<p>至少需要 61 根日K才能計算此分析。</p>');
    const weekly = Engine.weeklyTrend(rows, today());
    const support = result.srZones.find(item => item.role === 'support');
    const resistance = result.srZones.find(item => item.role === 'resistance');
    const zoneRole = item => `${['突破未確認', '跌破未確認', '區外站穩', '等待回測', '回測中'].includes(item.status) ? '原' : ''}${item.role === 'support' ? '支撐' : '壓力'}`;
    const zoneRange = item => `${fmt(Math.min(item.low, item.high))}–${fmt(Math.max(item.low, item.high))}`;
    const zoneText = item => item ? `${zoneRange(item)}（${escape(item.status)}，現價${escape(item.location)}）` : '未辨識符合條件的區間';
    const evidence = result.srZones.map(item => {
      const label = zoneRole(item);
      const origin = item.duration ? `${item.duration}日盤整` : `${item.turns}個明顯轉折`;
      const volume = item.source.includes('盤整') && item.volumeRatio !== null ? `；盤整期日均量／前20日 ${fmt(item.volumeRatio)}×` : '';
      const breakoutVolume = item.volumeRatioBreak !== null ? `；向上突破當日量比 ${fmt(item.volumeRatioBreak)}×${item.volumeRatioBreak >= 1.2 ? '（量能配合）' : '（未放量）'}` : '';
      return `<li><strong>${label} ${zoneRange(item)}</strong> · ${escape(item.status)}，現價${escape(item.location)}。${escape(item.source)} ${escape(item.date)}；${origin}；離開區域後反應 ${fmt(item.reaction)} ATR；${item.tests} 次分離測試，反應${escape(item.reactionTrend)}${volume}${breakoutVolume}。</li>`;
    }).join('');
    const details = evidence ? `<ul class="reason-list">${evidence}</ul>` : '<p>目前未辨識出有足夠歷史反應、且接近現價的水平區間。</p>';
    return `<div class="cards">${card('目前判讀', result.state, `${result.score}/4 項條件符合`)}${card('收盤 / 20日 / 60日', `${fmt(result.close)} / ${fmt(result.ma20)} / ${fmt(result.ma60)}`, `Fugle · ${result.date}`)}${card('RSI 14 / ATR 14', `${fmt(result.rsi14)} / ${fmt(result.atr14)}`, '動能與波動參考')}</div>${panel('日K、支撐壓力與主要趨勢', `${Charts.candlestick(rows, result)}<p class="subtle">最多顯示120根日K，對照區間形成日期。色帶是歷史轉折或價格盤整的候選反應區，非進出場指令；紫色線僅為最近60日收盤價回歸線，不是經第三次反應確認的趨勢線。</p>`)}<div class="grid">${panel('價位與風險', `<div class="numbers"><span>${support ? zoneRole(support) : '支撐'} ${zoneText(support)}</span><span>${resistance ? zoneRole(resistance) : '壓力'} ${zoneText(resistance)}</span><span>突破觀察 ${fmt(result.trigger)}</span><span>停損參考 ${fmt(result.stop)}</span><span>目標參考 ${fmt(result.target)}</span></div>${details}<p class="subtle">區間依歷史日K價格推估；日成交量只作補充，沒有逐價成交量或實際持倉成本資料。突破觀察仍是機會篩選的前20日高點；停損與目標沿用原情境公式。</p>`)}${panel('週線趨勢', weekly ? `<p>${escape(weekly.state)} · 最近完整週收盤 ${fmt(weekly.close)} · 10週均線 ${fmt(weekly.ma10)} · 30週均線 ${fmt(weekly.ma30)}。</p><p class="subtle">截至 ${escape(weekly.date)}；本週未完成時不納入。</p>` : '<p>完整週資料不足，無法計算10/30週均線。</p>')}${panel('判讀理由', `<ul class="reason-list">${result.reasons.map(reason => `<li>${escape(reason)}</li>`).join('')}</ul><p>20日動能 ${pct(result.momentum20)}；量比 ${fmt(result.volumeRatio)}×。</p>`)}</div>${note(`標的 ${ticker} · Fugle 還原日K · 截至 ${result.date}`)}`;
  }
  function backtestView(ticker, rows) {
    const result = Engine.backtest(rows);
    if (!result) return panel('資料不足', '<p>至少需要 90 根日K才能回測。</p>');
    const table = result.tradeRows.slice(-8).reverse().map(item => `<tr><td>${escape(item.entryDate)}</td><td>${escape(item.exitDate)}</td><td class="${cls(item.returnPct)}">${pct(item.returnPct)}</td></tr>`).join('');
    const fiveAgo = result.equity.at(-6);
    const recentStrategy = fiveAgo ? (result.equity.at(-1).value / fiveAgo.value - 1) * 100 : null;
    const recentHold = rows.length >= 6 ? (rows.at(-1).close / rows.at(-6).close - 1) * 100 : null;
    const direction = recentStrategy < 0 && recentHold < 0 ? '兩線最近都往下，表示策略權益與持有標的價格在這段期間都下滑。' : '';
    const drawdownDetail = result.drawdownTrough ? `前高 ${result.drawdownPeak.date}（權益 ${fmt(result.drawdownPeak.value, 6)}）到低點 ${result.drawdownTrough.date}（權益 ${fmt(result.drawdownTrough.value, 6)}）` : '期間未出現低於先前高點的收盤權益';
    return `<div class="cards">${card('策略總報酬', pct(result.totalReturn), `${result.start} 至 ${result.end}`)}${card('最大回撤', pct(result.maxDrawdown), '以每日收盤權益估算')}${card('已平倉交易', String(result.trades), `勝率 ${fmt(result.winRate)}% · 平均 ${pct(result.avgTrade)}`)}</div>${panel('策略與持有走勢', Charts.equity(result, rows))}${panel('數字怎麼算', `<p><strong>總報酬 ${pct(result.totalReturn)}</strong>：初始權益設為 1，期末權益為 ${fmt(result.finalEquity, 6)}；公式為（期末權益 ÷ 1 − 1）× 100。已平倉交易的報酬會複利累積；未平倉部位按最後收盤價估值。</p><p><strong>最大回撤 ${pct(result.maxDrawdown)}</strong>：逐日尋找從先前最高權益跌至其後低點的最大百分比；公式為（低點權益 ÷ 先前最高權益 − 1）× 100。${drawdownDetail}。因此回撤是過程中的最深跌幅，不是期末報酬。</p><p class="subtle">圖中金色實線是策略每日收盤權益相對初始權益的累積報酬；藍色虛線是同日起以開盤價買入並持有到各日收盤的累積報酬。滑鼠移入或點選曲線，可讀取同一天兩條線的數值。</p>`)}${panel('與持有比較', `<p>最近 5 個交易日：策略權益 ${pct(recentStrategy)}，買入持有標的 ${pct(recentHold)}。${direction}兩線的期末高低表示全期累積報酬的比較；策略期末${result.openPosition ? '仍持倉' : '空手'}。</p><p>同期買入持有：<strong class="${cls(result.buyHold)}">${pct(result.buyHold)}</strong>。策略期末${result.openPosition ? '仍持倉，未平倉損益已計入總報酬' : '無持倉'}。</p><p class="subtle">規則：20日均線上穿60日均線，次一交易日開盤買入；下穿時次一交易日開盤賣出。每次買入及賣出各扣 0.25% 假設成本。全額投入、不加碼。回測使用 Fugle 還原日K；不含個別券商費率、稅務差異及實際成交滑價。</p>`)}${panel('最近已平倉交易', table ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>進場</th><th>出場</th><th>淨報酬</th></tr></thead><tbody>${table}</tbody></table></div>` : '<p>期間內沒有完整的進出場交易。</p>')}${note(`標的 ${ticker} · Fugle 資料截至 ${rows.at(-1).date}`)}`;
  }
  function riskView(result, history, errors) {
    const rows = result.items.map(item => `<tr><td>${escape(item.ticker)} ${escape(item.name)}</td><td>${fmt(item.shares, 4)}</td><td>${fmt(item.price)}</td><td>${fmt(item.value, 0)}</td><td>${fmt(item.weight)}%</td><td>${fmt(item.beta)}</td><td class="${cls(item.shockLoss)}">${item.shockLoss === null ? '資料不足' : fmt(item.shockLoss, 0)}</td></tr>`).join('');
    const correlated = result.pairs.filter(item => item.value >= 0.8).slice(0, 5);
    const rebalance = result.items.filter(item => item.weight > 30).map(item => `${escape(item.ticker)}：若把約 NT$ ${fmt((item.weight / 100 - 0.3) * result.total, 0)} 轉為現金，原權重可降至約30%`).join('；');
    return `<div class="cards">${card('已定價持股市值', `NT$ ${fmt(result.total, 0)}`, `${result.coverage}/${result.items.length} 檔取得價格`)}${card('最大單一權重', `${fmt(result.largestWeight)}%`, result.largestWeight >= 30 ? '集中度較高，宜檢視' : '以目前可定價持股計')}${card('大盤 -20% 情境', result.estimatedLoss === null ? '資料不足' : `NT$ ${fmt(result.estimatedLoss, 0)}`, `Beta 覆蓋 ${result.betaCoverage}/${result.items.length} 檔`)}</div><div class="grid">${panel('持股權重', Charts.allocation(result.items) || '<p>尚無可計算持股。</p>')}${panel('情境假設', '<p>以最近最多90組共同交易日的日報酬估計各標的對加權指數 IX0001 的 Beta，再以「大盤下跌20% × Beta × 持股市值」估計單一情境損益。這是歷史線性敏感度，不是預測；相關性與 Beta 在壓力期間可能改變。</p><p class="subtle">缺任何持股價格或 Beta 時，不顯示完整組合的情境總損益。</p>')}</div>${panel('相關與再平衡', `<p>最近最多90組共同交易日中，相關係數 ≥ 0.8 的持股組合：${correlated.length ? correlated.map(item => `${escape(item.first)} / ${escape(item.second)} (${fmt(item.value)})`).join('；') : '沒有可辨識的高相關組合，或資料不足'}。</p><p>${rebalance || '目前沒有單一持股超過已定價組合的30%。'} 這只是轉入現金的權重情境，不是交易建議；未計稅費與價格變動。</p>`)}${panel('持股明細', `<div class="table-wrap"><table class="data-table"><thead><tr><th>標的</th><th>股數</th><th>日K收盤</th><th>市值</th><th>權重</th><th>Beta</th><th>-20% 情境</th></tr></thead><tbody>${rows}</tbody></table></div>`)}${failureNote(errors)}${note(freshness(history))}`;
  }
  function journalView(result, history, errors) {
    if (!result.filteredTotal) return panel('查無符合的交易', '<p>請調整日期、標的或買賣方向。</p>');
    const rows = result.recent.map(item => `<tr><td>${escape(item.date)}</td><td>${escape(item.ticker)}</td><td>${item.side === 'buy' ? '買入' : '賣出'}</td><td>${fmt(item.shares, 4)}</td><td>${fmt(item.price)}</td><td class="${cls(item.day1)}">${pct(item.day1)}</td><td class="${cls(item.day5)}">${pct(item.day5)}</td><td class="${cls(item.realized)}">${item.realized === null ? '—' : fmt(item.realized, 0)}</td><td>${item.notes ? escape(item.notes) : '—'}</td></tr>`).join('');
    return `<div class="cards">${card('符合篩選 / 全部交易', `${result.filteredTotal} / ${result.total}`, `第 ${result.page} / ${result.pageCount} 頁 · 每頁最多20筆` )}${card('本頁買入 / 賣出', `${result.buys} / ${result.sells}`, '來自 ETF_DCA-plan 原始紀錄')}${card('本頁已實現損益 / 5日後平均', `NT$ ${fmt(result.realized, 0)} / ${pct(result.avgDay5)}`, `${result.closed} 筆已平倉 · 5日後可評估 ${result.evaluated} 筆`)}</div>${panel('交易後相對走勢', `<p class="subtle">每列是一筆已記錄交易；同一代碼重複出現表示不同交易紀錄，不是再次買入指示。藍色比較交易後 1 個交易日，橘色比較 5 個交易日；買入後上漲或賣出後下跌顯示正值，反之為負值。條形與右側數字以相同百分比刻度表示。</p>${Charts.outcomes(result.recent) || '<p>沒有足夠的後續行情可繪圖。</p>'}`)}${panel('觀察與可執行規則', `<p>本頁 ${result.recent.length} 筆中，${result.notes}筆有備註。買入後的 1 / 5 個交易日結果用當時成交價對照之後日K；賣出後以反向價格變動表示。這些是事後觀察，不能單憑漲跌判定當時決策對錯。</p><ol class="reason-list"><li>每次交易前記下進場理由與失效條件，讓日後能核對是否按計畫執行。</li><li>新增部位前檢查組合頁最大單一權重，避免集中度在不知不覺中增加。</li><li>先用回測頁檢查策略與成本，再決定是否調整規則；不要由少數交易推論勝率。</li></ol><p class="subtle">未成交的錯失機會及主觀行為偏誤需要當時的決策紀錄；僅憑成交紀錄無法可靠辨識。</p>`)}${panel('本頁交易紀錄', `<div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>標的</th><th>方向</th><th>股數</th><th>成交價</th><th>1日後</th><th>5日後</th><th>已實現損益</th><th>備註</th></tr></thead><tbody>${rows}</tbody></table></div>`)}${failureNote(errors)}${note(`ETF_DCA-plan origin/main · ${freshness(history)} · 價格變動與已實現損益均未扣交易成本`)}`;
  }

  function bindInteractiveCharts() {
    document.querySelectorAll('.chart-interactive').forEach(chart => {
      const readout = chart.querySelector('[data-chart-readout]');
      const crosshair = chart.querySelector('.chart-crosshair');
      let selected = null;
      function show(event) {
        const hit = event.target.closest?.('.chart-hit');
        if (!hit || !chart.contains(hit) || selected === hit) return;
        selected = hit;
        if (hit.dataset.chartPoint === 'candle') {
          readout.textContent = `${hit.dataset.date}　開 ${fmt(hit.dataset.open)}　高 ${fmt(hit.dataset.high)}　低 ${fmt(hit.dataset.low)}　收 ${fmt(hit.dataset.close)}　量 ${fmt(hit.dataset.volume, 0)}　漲跌 ${pct(Number(hit.dataset.change))}`;
        } else if (hit.dataset.chartPoint === 'equity') {
          readout.textContent = `${hit.dataset.date}　策略 ${pct(Number(hit.dataset.strategy))}　買入持有 ${pct(Number(hit.dataset.hold))}`;
        }
        crosshair?.setAttribute('x1', hit.dataset.x);
        crosshair?.setAttribute('x2', hit.dataset.x);
        crosshair?.setAttribute('visibility', 'visible');
      }
      chart.addEventListener('pointermove', show);
      chart.addEventListener('pointerdown', show);
      chart.addEventListener('focusin', show);
    });
  }

  async function run(reusePortfolio = false) {
    const button = $('run-button');
    if (button.disabled) return;
    button.disabled = true;
    setMessage('讀取最新資料並計算中…');
    $('results').innerHTML = '';
    $('journal-pager').hidden = true;
    try {
      if (!reusePortfolio || !portfolio) await loadPortfolio();
      if (activeTab === 'risk' || activeTab === 'journal') {
        if (!portfolio) throw new Error(`無法讀取 ETF_DCA-plan：${portfolioError}`);
      }
      let symbols, journalSelection, options;
      if (activeTab === 'ideas') symbols = symbolList().map(item => item.ticker);
      else if (activeTab === 'technical' || activeTab === 'backtest') symbols = [$('symbol-select').value];
      else if (activeTab === 'risk') symbols = [...new Set([...Engine.holdings(portfolio).map(item => item.ticker), 'IX0001'])];
      else {
        options = journalOptions();
        journalSelection = Engine.selectTrades(portfolio, options);
        journalPage = journalSelection.page;
        symbols = [...new Set(journalSelection.items.map(item => item.ticker))];
      }
      const { history, errors } = await getMany(symbols);
      if (!Object.keys(history).length && activeTab !== 'journal') throw new Error(errors.join('；') || '無可用行情');
      if (activeTab === 'ideas') $('results').innerHTML = ideasView(history, errors);
      if (activeTab === 'technical') $('results').innerHTML = technicalView(symbols[0], history[symbols[0]] || []);
      if (activeTab === 'backtest') $('results').innerHTML = backtestView(symbols[0], history[symbols[0]] || []);
      if (activeTab === 'risk') $('results').innerHTML = riskView(Engine.portfolioRisk(portfolio, history), history, errors);
      if (activeTab === 'journal') {
        const result = Engine.journal(portfolio, history, { ...options, page: journalPage });
        $('results').innerHTML = journalView(result, history, errors);
        updateJournalPager(result);
      }
      bindInteractiveCharts();
      document.querySelectorAll('.chart-wrap').forEach(chart => { chart.scrollLeft = chart.scrollWidth; });
      setMessage(`分析完成 · ${Object.keys(history).length}/${symbols.length} 個行情來源可用${errors.length ? ` · ${errors.length} 個未取得` : ''}`);
    } catch (error) {
      setMessage(String(error.message || error), true);
      $('results').innerHTML = panel('無法完成分析', '<p>請確認資料來源及 Fugle Key，然後再試一次。已取得的資料不會被寫回 ETF_DCA-plan。</p>');
    } finally { button.disabled = false; }
  }

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
    $('section-title').textContent = TITLES[activeTab][0];
    $('section-description').textContent = TITLES[activeTab][1];
    $('symbol-control').hidden = activeTab !== 'technical' && activeTab !== 'backtest';
    $('journal-controls').hidden = activeTab !== 'journal';
    $('journal-pager').hidden = true;
    $('results').replaceChildren();
    setMessage('點「更新分析」取得此頁結果。');
  }));
  $('symbol-control').hidden = true;
  $('run-button').addEventListener('click', () => run());
  $('journal-apply').addEventListener('click', () => { journalPage = 1; run(true); });
  $('journal-reset').addEventListener('click', () => {
    for (const id of ['journal-from', 'journal-to', 'journal-ticker', 'journal-side']) $(id).value = '';
    journalPage = 1;
    run(true);
  });
  $('journal-prev').addEventListener('click', () => { if (journalPage > 1) { journalPage--; run(true); } });
  $('journal-next').addEventListener('click', () => { journalPage++; run(true); });
  $('settings-button').addEventListener('click', () => { $('fugle-key').value = localStorage.getItem(KEY_STORAGE) || ''; $('settings-dialog').showModal(); });
  $('save-key').addEventListener('click', () => {
    const key = $('fugle-key').value.trim();
    if (!key) return setMessage('請輸入 Fugle API Key', true);
    localStorage.setItem(KEY_STORAGE, key);
    historyCache.clear();
    $('settings-dialog').close();
    setSourceStatus();
    setMessage('Fugle Key 已儲存。點「更新分析」即可取得結果。');
  });
  $('clear-key').addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE); historyCache.clear(); $('fugle-key').value = '';
    setSourceStatus(); setMessage('Fugle Key 已清除。');
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  loadPortfolio().then(() => {
    if (!localStorage.getItem(KEY_STORAGE)) $('settings-dialog').showModal();
    else setMessage('資料來源已就緒。點「更新分析」取得目前頁面的結果。');
  });
})();
