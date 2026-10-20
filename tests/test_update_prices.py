"""Unit tests for the price job. Run from the repo root: python3 -m unittest discover tests"""
import datetime as dt
import sys
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, "scripts")
import update_prices as up  # noqa: E402

ET = ZoneInfo("America/Toronto")


class YahooSymbols(unittest.TestCase):
    def test_suffixes(self):
        self.assertEqual(up.yahoo_symbol("TSX", "xeqt"), "XEQT.TO")
        self.assertEqual(up.yahoo_symbol("TSX", "BAM.A"), "BAM-A.TO")
        self.assertEqual(up.yahoo_symbol("TSXV", "abc"), "ABC.V")
        self.assertEqual(up.yahoo_symbol("NEO", "ABC"), "ABC.NE")
        self.assertEqual(up.yahoo_symbol("US", "BRK.B"), "BRK-B")
        self.assertEqual(up.yahoo_symbol("CRYPTO", "btc"), "BTC-USD")


class LastCloses(unittest.TestCase):
    rows = [(dt.date(2026, 10, 13), 45.0), (dt.date(2026, 10, 14), 46.0), (dt.date(2026, 10, 15), 47.0)]

    def test_after_close_uses_today(self):
        now = dt.datetime(2026, 10, 15, 18, 30, tzinfo=ET)
        self.assertEqual(up.last_closes(self.rows, now), (47.0, 46.0, dt.date(2026, 10, 15)))

    def test_during_session_drops_today(self):
        now = dt.datetime(2026, 10, 15, 11, 0, tzinfo=ET)
        self.assertEqual(up.last_closes(self.rows, now), (46.0, 45.0, dt.date(2026, 10, 14)))

    def test_holiday_keeps_last_session(self):
        now = dt.datetime(2026, 10, 16, 18, 30, tzinfo=ET)
        self.assertEqual(up.last_closes(self.rows, now)[2], dt.date(2026, 10, 15))

    def test_single_row(self):
        now = dt.datetime(2026, 10, 15, 18, 30, tzinfo=ET)
        self.assertEqual(up.last_closes(self.rows[:1], now), (45.0, None, dt.date(2026, 10, 13)))

    def test_empty(self):
        now = dt.datetime(2026, 10, 15, 18, 30, tzinfo=ET)
        self.assertIsNone(up.last_closes([], now))


class Headers(unittest.TestCase):
    def test_new_secret_key_not_in_authorization(self):
        db = up.Supabase("https://x.supabase.co/", "sb_secret_abc")
        self.assertEqual(db.headers["apikey"], "sb_secret_abc")
        self.assertNotIn("Authorization", db.headers)
        self.assertEqual(db.base, "https://x.supabase.co/rest/v1")

    def test_legacy_key_in_both(self):
        db = up.Supabase("https://x.supabase.co", "eyJhbGciOi.fake")
        self.assertEqual(db.headers["Authorization"], "Bearer eyJhbGciOi.fake")


if __name__ == "__main__":
    unittest.main()
