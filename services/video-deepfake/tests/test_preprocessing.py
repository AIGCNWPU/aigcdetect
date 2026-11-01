import os
from pathlib import Path
import sys
import unittest
import tempfile
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from faces import FaceDetector, crop_face


@unittest.skipUnless(
    Path(
        os.environ.get("YUNET_CHECKPOINT", ROOT / "artifacts/face_detection_yunet.onnx")
    ).is_file(),
    "Download YuNet or set YUNET_CHECKPOINT",
)
class PreprocessingTests(unittest.TestCase):
    def test_rotated_face_and_square_crop(self):
        from skimage import data

        image = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
        detector = FaceDetector()
        rotated = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        rotation = detector.orient(rotated)
        upright = rotated if rotation is None else cv2.rotate(rotated, rotation)
        boxes = detector.detect(upright)
        self.assertTrue(boxes)
        crop = crop_face(upright, boxes[0])
        self.assertEqual(crop.shape[0], crop.shape[1])

    def test_two_positions_and_no_face(self):
        from skimage import data

        image = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
        detector = FaceDetector()
        self.assertEqual(len(detector.detect(cv2.hconcat([image, image]))), 2)
        self.assertEqual(
            len(detector.detect(np.zeros((480, 640, 3), dtype=np.uint8))), 0
        )

    def test_no_face_never_returns_low_risk(self):
        import app

        class NeverCalled:
            params = 0
            device = "cpu"
            def score(self, image):
                raise AssertionError("No-face video must not be scored")

        previous = app.engine
        app.engine = NeverCalled()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path = str(Path(folder) / "blank.mp4")
                writer = cv2.VideoWriter(
                    path, cv2.VideoWriter_fourcc(*"mp4v"), 12, (320, 240)
                )
                self.assertTrue(writer.isOpened())
                for _ in range(24):
                    writer.write(np.zeros((240, 320, 3), np.uint8))
                writer.release()
                result = app.analyze(path)
                self.assertEqual(result["risk"], "unknown")
                self.assertEqual(result["persons"], [])
                self.assertEqual(result["findings"], [])
                self.assertTrue(any("YuNet" in note for note in result["meta"]["notes"]))
        finally:
            app.engine = previous
