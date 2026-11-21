"""Shared model layout and CPU budgets used by training and prediction."""

from pathlib import Path

import tomllib

CONFIG = tomllib.loads(Path(__file__).with_name("config.toml").read_text())
