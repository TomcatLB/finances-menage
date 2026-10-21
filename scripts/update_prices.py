"""Daily closing-price update for Finances du ménage.

1. Reads the holdings from Supabase.
2. Fetches the latest daily close for every listed symbol (Yahoo Finance, via
   yfinance) and the USD/CAD rate (Bank of Canada Valet API).
3. Writes them to the `prices` table.
4. Writes today's net-worth snapshot to `snapshots` (same formula as calc.js).

With PRICE_MODE=intraday (every 30 minutes while markets are open) it keeps the
price of the session in progress and skips the snapshot: the evening run writes
the close and the day's snapshot.

Environment:
  SUPABASE_URL          https://<project>.supabase.co
  SUPABASE_SERVICE_KEY  the project's secret key (sb_secret_…) or legacy service_role key
  PRICE_MODE            "intraday" for the runs during the session; anything else is the evening run
"""
from __future__ import annotations

import datetime as dt
import math
import os
import sys
from zoneinfo import ZoneInfo

import requests

AUTO_SUFFIX = {"TSX": ".TO", "TSXV": ".V", "NEO": ".NE", "US": "", "CRYPTO": "-USD"}
USD_MARKETS = ("US", "CRYPTO")
TORONTO = ZoneInfo("America/Toronto")
MARKET_CLOSE_BUFFER = dt.time(16, 20)  # a bar for "today" before this time is still intraday
BOC_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"


# ----------------------------------------------------------------------------
# Supabase REST
# ----------------------------------------------------------------------------
class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        # Legacy service_role keys are JWTs and also go in Authorization.
        # New sb_secret_ keys are sent only as `apikey`.
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"

    def get(self, table: str, query: str = "select=*") -> list[dict]:
        r = requests.get(f"{self.base}/{table}?{query}", headers=self.headers, timeout=30)
        _check(r, f"read {table}")
        return r.json()

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        if not rows:
            return
        headers = dict(self.headers, Prefer="resolution=merge-duplicates,return=minimal")
        r = requests.post(
            f"{self.base}/{table}?on_conflict={on_conflict}", json=rows, headers=headers, timeout=30
        )
        _check(r, f"write {table}")


def _check(r: requests.Response, what: str) -> None:
    if r.status_code >= 300:
        raise RuntimeError(f"Could not {what}: HTTP {r.status_code} {r.text[:300]}")


# ----------------------------------------------------------------------------
# Prices
# ----------------------------------------------------------------------------
def yahoo_symbol(market: str, symbol: str) -> str:
    """XEQT on TSX -> XEQT.TO; class shares use a dash on Yahoo: BAM.A -> BAM-A.TO, BRK.B -> BRK-B; BTC -> BTC-USD."""
    s, suffix = symbol.strip().upper(), AUTO_SUFFIX[market]
    if suffix.startswith(".") and s.endswith(suffix):
        s = s[: -len(suffix)]  # typed with Yahoo's own suffix: VEE.TO on TSX
    return s.replace(".", "-") + suffix


def last_closes(closes, now_et: dt.datetime, intraday: bool = False):
    """closes: list of (date, close) sorted by date, NaNs removed.
    Returns (close, prev_close, date) of the last *completed* session, or None.
    intraday=True keeps today's bar: its "close" is the latest trade."""
    rows = list(closes)
    if not intraday and rows and rows[-1][0] == now_et.date() and now_et.time() < MARKET_CLOSE_BUFFER:
        rows = rows[:-1]  # today's bar is still moving
    if not rows:
        return None
    close_date, close = rows[-1]
    prev = rows[-2][1] if len(rows) > 1 else None
    return close, prev, close_date


def fetch_yahoo(ysym: str, now_et: dt.datetime, intraday: bool = False):
    import yfinance as yf

    # auto_adjust=False: the plain closing price, not one adjusted for dividends.
    hist = yf.Ticker(ysym).history(period="10d", interval="1d", auto_adjust=False)
    if hist is None or hist.empty or "Close" not in hist:
        return None
    rows = []
    for ts, value in hist["Close"].items():
        v = float(value)
        if math.isfinite(v) and v > 0:
            rows.append((ts.date(), v))
    rows.sort()
    return last_closes(rows, now_et, intraday)


def fetch_usdcad():
    r = requests.get(BOC_URL, params={"recent": 5}, timeout=30)
    r.raise_for_status()
    obs = sorted(r.json()["observations"], key=lambda o: o["d"])
    obs = [o for o in obs if o.get("FXUSDCAD", {}).get("v")]
    if not obs:
        return None
    last = obs[-1]
    prev = obs[-2] if len(obs) > 1 else None
    return (
        float(last["FXUSDCAD"]["v"]),
        float(prev["FXUSDCAD"]["v"]) if prev else None,
        dt.date.fromisoformat(last["d"]),
    )


# ----------------------------------------------------------------------------
# Snapshot — must match calc.js (valueHolding / totals / snapshotData)
# ----------------------------------------------------------------------------
def num(v) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    return x if x == x and x not in (float("inf"), float("-inf")) else 0.0


def share(owner, who: str) -> float:
    if who == "all":
        return 1.0
    o = owner or "joint"
    if o == who:
        return 1.0
    if o == "joint":
        return 0.5
    return 0.0


def price_key(h: dict) -> str:
    return f"{h['market']}:{str(h.get('symbol') or '').strip().upper()}"


def value_holding(h: dict, prices: dict):
    qty = num(h.get("qty"))
    cost = num(h.get("avg_cost"))
    market = h.get("market")
    if market == "CASH":
        px = 1.0
    elif market == "MANUAL":
        mp = h.get("manual_price")
        px = num(mp) if mp not in (None, "") else cost
    else:
        p = prices.get(price_key(h))
        px = num(p["close"]) if p and p.get("close") is not None else cost
    if h.get("currency") == "USD":
        fx = prices.get("FX:USDCAD")
        rate = num(fx["close"]) if fx and num(fx.get("close")) > 0 else None
    else:
        rate = 1.0
    if rate is None:
        return None
    return qty * px * rate


def totals(data: dict, who: str) -> dict:
    inv = oth = debt = 0.0
    missing = 0
    for h in data["holdings"]:
        s = share(h.get("owner"), who)
        if not s:
            continue
        v = value_holding(h, data["prices"])
        if v is None:
            missing += 1
            continue
        inv += v * s
    for a in data["assets"]:
        oth += num(a.get("value")) * share(a.get("owner"), who)
    for d in data["debts"]:
        debt += num(d.get("balance")) * share(d.get("owner"), who)
    return {"inv": inv, "oth": oth, "debt": debt, "net": inv + oth - debt, "missing": missing}


def r2(x: float) -> float:
    """Round half away from zero to the cent (same rule as calc.js)."""
    return (-1 if x < 0 else 1) * math.floor(abs(x) * 100 + 0.5) / 100


def snapshot_data(data: dict) -> dict:
    out = {}
    for who in ("all", "p1", "p2"):
        t = totals(data, who)
        out[who] = {k: r2(t[k]) for k in ("inv", "oth", "debt", "net")}
    return out


# ----------------------------------------------------------------------------
def main() -> int:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        print("::error::Add SUPABASE_URL and SUPABASE_SERVICE_KEY as repository secrets.")
        return 1
    db = Supabase(url, key)
    intraday = os.environ.get("PRICE_MODE", "").strip().lower() == "intraday"
    now_et = dt.datetime.now(TORONTO)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    holdings = db.get("holdings")
    wanted = {}
    for h in holdings:
        if h.get("market") in AUTO_SUFFIX and str(h.get("symbol") or "").strip():
            wanted[price_key(h)] = (h["market"], h["symbol"])
    print(f"{len(holdings)} holdings, {len(wanted)} symbols to price.")

    existing = {p["symbol_key"]: p for p in db.get("prices")}
    rows, failures, warnings = [], [], []

    for key_, (market, symbol) in sorted(wanted.items()):
        ysym = yahoo_symbol(market, symbol)
        try:
            got = fetch_yahoo(ysym, now_et, intraday)
        except Exception as exc:  # network or parsing problem for one symbol
            got = None
            print(f"  {ysym}: error {exc!r}")
        if not got:
            failures.append(f"{key_} ({ysym})")
            continue
        close, prev, close_date = got
        old = existing.get(key_)
        if old and num(old.get("close")) > 0:
            move = close / num(old["close"]) - 1
            if abs(move) > 0.4:
                warnings.append(f"{key_}: {move:+.0%} since the last stored close (split or data error?)")
        rows.append({
            "symbol_key": key_,
            "close": close,
            "prev_close": prev,
            "currency": "USD" if market in USD_MARKETS else "CAD",
            "price_date": close_date.isoformat(),
            "source": "Yahoo Finance (intraday)" if intraday else "Yahoo Finance (yfinance)",
            "fetched_at": now_iso,
        })
        print(f"  {ysym}: {close} on {close_date}")

    try:
        fx = fetch_usdcad()
    except Exception as exc:
        fx = None
        print(f"  USD/CAD: error {exc!r}")
    if fx:
        rows.append({
            "symbol_key": "FX:USDCAD",
            "close": fx[0],
            "prev_close": fx[1],
            "currency": "CAD",
            "price_date": fx[2].isoformat(),
            "source": "Banque du Canada",
            "fetched_at": now_iso,
        })
        print(f"  USD/CAD: {fx[0]} on {fx[2]}")
    else:
        failures.append("FX:USDCAD (Bank of Canada)")

    db.upsert("prices", rows, "symbol_key")

    if intraday:
        # The net-worth chart keeps one point per day, at the close: the evening run writes it.
        for w in warnings:
            print(f"::warning::{w}")
        if failures:
            print("::warning::No price found for: " + ", ".join(failures))
        return 0

    # Snapshot, dated by the most recent market close we have.
    prices = {p["symbol_key"]: p for p in db.get("prices")}
    data = {
        "holdings": holdings,
        "prices": prices,
        "assets": db.get("assets"),
        "debts": db.get("debts"),
    }
    # Crypto trades every day: its date says nothing about the last market close.
    stock_dates = [prices[k]["price_date"] for k in wanted if k in prices and wanted[k][0] != "CRYPTO"]
    snap_date = max(stock_dates) if stock_dates else now_et.date().isoformat()
    db.upsert(
        "snapshots",
        [{"snap_date": snap_date, "data": snapshot_data(data), "source": "auto"}],
        "snap_date",
    )
    print(f"Snapshot written for {snap_date}.")

    for w in warnings:
        print(f"::warning::{w}")
    if failures:
        print("::warning::No price found for: " + ", ".join(failures)
              + ". Check the symbol and market in the app; these keep their last price.")
    # Fail the run only if nothing at all could be priced, so GitHub emails the owner.
    if wanted and len(failures) >= len(wanted):
        print("::error::No closing price could be fetched.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
