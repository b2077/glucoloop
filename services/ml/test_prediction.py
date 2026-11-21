"""Check that forecasts use every trained horizon and all 24 envelope hours.

Run from services/ml with the training dependencies installed:
    python -m unittest test_prediction -v

The models are replaced with deterministic stand-ins, so these checks need no
training data, saved model files, running services, or external API requests.
"""

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
from predict_api import Predictor
from train import main


def fixed_model(value):
    """Return a model whose prediction identifies which artifact was used."""
    return SimpleNamespace(predict=lambda row: [value])


class PredictionCoverageTests(unittest.TestCase):
    """Protect independently trained outputs from endpoint interpolation."""

    def setUp(self):
        self.predictor = Predictor.__new__(Predictor)
        self.values = {"t5": 100, "t15": 117, "t30": 103, "t45": 142, "t60": 121}
        self.predictor.points = {
            name: fixed_model(value) for name, value in self.values.items()
        }
        self.predictor.blocks = {
            (block, stat): fixed_model(base + block**power)
            for block in range(6)
            for stat, base, power in (("min", 80, 2), ("max", 180, 3))
        }
        self.predictor.action = SimpleNamespace(
            classes_=["no_op"], predict_proba=lambda row: [[1.0]]
        )
        self.predictor.meta = {}

    def forecast(self):
        """Isolate model selection from the separately owned feature builder."""
        with patch("predict_api.features_from_window", return_value=[1.0]):
            return self.predictor.predict({"readings": [{}]})

    def test_each_point_horizon_uses_its_own_model(self):
        forecast = self.forecast()
        self.assertEqual(forecast["short"], {"minutes": 5, "point": 100})
        self.assertEqual(
            forecast["medium"],
            [
                {"minutes": int(name[1:]), "point": value}
                for name, value in self.values.items()
            ],
        )

    def test_all_six_independent_blocks_cover_twenty_four_hours(self):
        blocks = self.forecast()["long"]
        self.assertEqual(len(blocks), 6)
        for block, result in enumerate(blocks):
            with self.subTest(block=block):
                self.assertEqual(result["window_start_h"], 4 * block)
                self.assertEqual(result["window_end_h"], 4 * (block + 1))
                self.assertEqual(result["min_q10"], 80 + block**2)
                self.assertEqual(result["max_q90"], 180 + block**3)

    def test_missing_final_block_artifact_prevents_initialization(self):
        missing = "block_5_max.joblib"

        def load_model(path):
            if path.name == missing:
                raise FileNotFoundError(path)
            return fixed_model(100)

        with (
            patch("predict_api.joblib.load", side_effect=load_model),
            patch.object(Path, "read_text", return_value="{}"),
            patch.object(
                Path,
                "exists",
                autospec=True,
                side_effect=lambda path: path.name != missing,
            ),
            self.assertRaises(FileNotFoundError),
        ):
            Predictor()


class TrainingSplitTests(unittest.TestCase):
    """Refuse evaluation on a scenario included in training."""

    def test_overlap_is_rejected_before_features_or_fit(self):
        frame = pd.DataFrame({"scenario_id": [42]})
        with (
            patch("train.pd.read_csv", return_value=frame),
            self.assertRaisesRegex(ValueError, "scenarios overlap"),
        ):
            main()


if __name__ == "__main__":
    unittest.main()
