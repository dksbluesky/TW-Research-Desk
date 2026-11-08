# 台股研究桌 / TW Research Desk

A separate, read-only Taiwan stock research PWA. Five screens provide candidate screening, technical analysis, a simple reproducible backtest, portfolio risk, and review of recorded trades. No prompt or command entry, brokerage connection, or order placement.

## Data

- Holdings and executed transactions: read-only fetch of `portfolio-data.json` from `dksbluesky/ETF_DCA-plan` `main` on GitHub. The source repository is public. This app never writes to it, copies its values into source control, or asks for a GitHub token.
- Prices: Fugle historical daily candles, using the user's Market Data API key in this browser's `localStorage`. The key is sent only to Fugle as `X-API-KEY`. Each device needs its own setup. The app requests the past 350 calendar days with `adjusted=true`; the API permits a single period shorter than one year.
- The candidate universe is a fixed starter list of ten major Taiwan stocks and ETFs, plus all tickers currently in the portfolio file. It is **not** a whole-market scan or a current index constituent list. Any symbol without sufficient data is excluded and reported.
- The optional ETF_DCA-plan decision journal is stored in browser `localStorage` and is not the same as executed trades. This app reviews executed trade records from the portfolio file and does not label price losses as behavioral mistakes.

## Methods and limits

- Opportunities score four observable daily conditions (20-day price trend, 20/60-day trend, 20-day momentum, and volume versus the prior 20 days). A high score is a research candidate, not a measured win probability. Each candidate includes a recent-close sparkline.
- The technical chart shows up to 120 daily candles, volume, 20/60-day moving averages, and up to two horizontal S/R zones. Hover, tap, or focus a K bar for date, OHLC, volume, and price change. The purple regression still uses only the latest 60 closes; it is **not** a wick-based, third-touch-confirmed trendline. RSI/ATR, weekly trend, and stop/target scenarios remain separate. The opportunity breakout reference is still the prior 20-day high.
- **Swing candidates:** a high/low must exceed the three candles on each side, have at least 0.75 of its own historical 14-day ATR of preceding movement, and show at least 1.5 ATR of subsequent *closing-price* reaction within eight trading days. Its ATR is calculated using only candles available at the turn. Nearby turns are grouped only within 0.75 ATR of the group's first turn, avoiding chain widening. The group's price span is padded by 0.35 ATR. These numerical thresholds are automation assumptions, not values given by the video.
- **Price-consolidation candidates:** examine 15, 20, 25, and 30-day windows. The high-low range must be no more than 3 ATR and the start-to-end close drift no more than 1.25 ATR. Within the next eight candles, two consecutive closes must leave the range by 0.25 ATR and the move must reach 1 ATR beyond the range. Average daily volume compared with the prior 20 days is reported as context only. This is inferred *price consolidation*, not measured volume traded at each price or actual investor cost basis.
- **Evidence and states:** distinct tests must be at least six trading days apart; a test's rebound or pullback uses the next five closes. Three tests are required before calling reactions stronger or weaker, with at least 0.2 ATR change at each step and 0.75 ATR overall. A closing break must pass the zone by 0.1 ATR; three consecutive closes outside establish acceptance. A later touch within 0.2 ATR starts a retest; a subsequent close back on the breakout side within three trading days is required for role reversal. A single retest candle is not sufficient. Early return or a failed retest is labeled a failed break. Upward volume of at least 1.2 times the prior 20-day average is reported as supporting evidence, not a gate; downward breaks have no high-volume requirement. These statuses are observations, not trading signals.
- Selection prefers historically meaningful and relevant candidates within eight recent ATR of the latest close. Proximity alone does not determine the choice, a zone containing price remains visible, and no zone is shown when evidence is insufficient. Round numbers are not generated as standalone levels. Adjusted daily OHLCV cannot reveal intraday event order, actual volume-at-price, or traders' positions. The roughly 350-calendar-day request also limits older levels; compare displayed zones with dated Fugle charts before relying on them.
- The backtest charts a solid gold strategy line against a dashed blue buy-and-hold line. The vertical axis uses rounded cumulative-return ticks, which are not performance metrics. Hover or tap a date to see both values. Total return is `(final equity / initial equity - 1) × 100`; max drawdown is the greatest `(trough / previous peak - 1) × 100` in the daily equity path, with peak/trough dates shown. It buys at the **next** opening price after a 20-day MA cross above the 60-day MA, sells at the next open after a cross below, and assumes 0.25% costs on each side. It uses adjusted daily prices and marks open positions at the final close. Taxes, broker fees, liquidity and execution slippage vary in reality; the 0.25% is a disclosed assumption, not an exact Taiwan fee schedule.
- Portfolio risk charts holding weights, estimates 90-common-day beta to IX0001, and applies a hypothetical -20% index move. This is a historical linear scenario, not a forecast. An incomplete data set suppresses the aggregate scenario figure.
- Journal filters all recorded trades by inclusive date range, ticker, and buy/sell direction, then shows 20 per page in newest-first order. Its chart covers only the current page and labels one row per recorded trade (date, ticker, buy/sell direction), with a percentage scale and numeric blue 1-day/orange 5-day bars. Repeated tickers are separate recorded trades, not new trade instructions. It compares later closes with recorded execution prices at 1/3/5 days. Old trades outside the fetched 350-day history or with insufficient future trading days show missing data. The direction is reversed for sales, so positive means a favorable post-trade price move for the recorded direction. These figures exclude costs and do not establish whether a decision was correct.

## Run locally

Serve the directory over HTTP (service workers and some APIs do not work from `file://`):

```sh
python -m http.server 8000
```

Open `http://localhost:8000/`, enter a Fugle key once in Settings, choose a screen and click **更新分析**. The portfolio source needs internet access. The app shell can work offline after installation, but market and portfolio updates need network access.

## Public PWA

Open `https://dksbluesky.github.io/TW-Research-Desk/` in a browser. On Android, use the browser's **Install app** or **Add to Home screen** menu. Each device needs its own Fugle API key entered in Settings; the key stays in that browser's local storage and is not included in the repository. Live market and portfolio data require internet access.

## Verify

```sh
node engine.test.js
node charts.test.js
node --check engine.js
node --check charts.js
node --check app.js
```

No dependencies or build step are required for the app. GitHub Pages serves the repository root from `main`.
