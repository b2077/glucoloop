"""Check training and live features agree using synthetic sensor histories.

Run from services/ml with numpy and pandas installed:
    python -m unittest test_features -v

No stored patient data, running services, or external APIs are used.
"""

import unittest

import numpy as np
import pandas as pd
from features import FEATURES, features_from_df, features_from_window


def sensor_rows(glucose, scenario=1):
    """Build simulator-shaped inputs with varying non-glucose features."""
    return pd.DataFrame(
        [
            {
                "scenario_id": scenario,
                "t": (i + 1) * 5,
                "minute_of_day": ((i + 1) * 5) % 1440,
                "cgm_glucose": value,
                "cgm_quality": "dropout" if pd.isna(value) else "ok",
                "iob": i / 10,
                "commanded_basal": 1 + i / 100,
                "hr": 70 + i,
                "activity": "moderate" if i % 2 else "none",
                "carbs_g_3h": i,
                "exercise_min_2h": i / 2,
                "sleep_hours_last": 7.5,
                "stress_1_5": 1 + i % 5,
                "pump_status": "occlusion" if i % 7 == 0 else "ok",
            }
            for i, value in enumerate(glucose)
        ]
    )


def live_window(frame):
    """Translate simulator field names to the serving contract."""
    return frame.rename(columns={"cgm_glucose": "glucose_mgdl"}).to_dict("records")


class FeatureHistoryTests(unittest.TestCase):
    """Protect dropout handling, chronology, and scenario isolation."""

    def test_all_features_match_live_windows_at_dropout_boundaries(self):
        glucose = [100.0 + i for i in range(40)]
        for i in (0, 1, 10, 11, 12, 21, 22, 23, 34, 35, 39):
            glucose[i] = np.nan
        source = sensor_rows(glucose)
        trained = features_from_df(source).set_index("t")
        for i in range(12, len(source)):
            with self.subTest(row=i):
                live = features_from_window(live_window(source.iloc[i - 11 : i + 1]))
                actual = trained.loc[(i + 1) * 5, FEATURES].to_numpy(dtype=float)
                np.testing.assert_allclose(actual, live)

    def test_all_missing_window_is_excluded_and_live_returns_none(self):
        source = sensor_rows([100.0] * 13 + [np.nan] * 12 + [140.0] * 3)
        trained = features_from_df(source)
        self.assertNotIn(125, trained["t"].tolist())
        self.assertIsNone(features_from_window(live_window(source.iloc[13:25])))
        self.assertIn(130, trained["t"].tolist())

    def test_future_readings_do_not_create_or_change_earlier_features(self):
        source = sensor_rows([np.nan] * 25 + [100.0, 120.0, 110.0, 140.0, 130.0])
        full = features_from_df(source)
        self.assertTrue(full.loc[full["t"] <= 125].empty)
        for count in (20, 28):
            with self.subTest(prefix_rows=count):
                prefix = features_from_df(source.iloc[:count])
                earlier = full.loc[full["t"] <= count * 5]
                pd.testing.assert_frame_equal(
                    prefix.reset_index(drop=True),
                    earlier.reset_index(drop=True),
                    check_dtype=False,
                )

    def test_history_does_not_cross_scenario_boundaries(self):
        source = pd.concat(
            [
                sensor_rows([190.0] * 20, scenario=1),
                sensor_rows([np.nan] * 20, scenario=2),
            ],
            ignore_index=True,
        )
        trained = features_from_df(source)
        self.assertEqual(set(trained["scenario_id"]), {1})
        self.assertTrue((trained["g0"] == 190.0).all())


if __name__ == "__main__":
    unittest.main()
