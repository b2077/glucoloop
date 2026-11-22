"""Check CPU limits in a real training worker without fitting or external calls.

After installing services/ml/requirements.txt, run from services/ml:
    python -m unittest test_training
"""

import unittest
from concurrent.futures import ProcessPoolExecutor

from threadpoolctl import threadpool_info
from train import _init_worker


class TrainingThreadsTest(unittest.TestCase):
    """Guard against initialized numerical libraries ignoring worker limits."""

    def test_worker_limits_initialized_libraries(self):
        """Importing sklearn before forking must still permit a one-thread limit."""
        with ProcessPoolExecutor(
            max_workers=1, initializer=_init_worker, initargs=(1,)
        ) as executor:
            pools = executor.submit(threadpool_info).result(timeout=30)
        self.assertTrue(pools)
        for pool in pools:
            self.assertEqual(pool["num_threads"], 1, pool["internal_api"])


if __name__ == "__main__":
    unittest.main()
