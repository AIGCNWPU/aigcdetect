from pathlib import Path
import cv2, numpy as np
import os


class FaceDetector:
    def __init__(self):
        self.net = cv2.FaceDetectorYN_create(
            os.environ.get(
                "YUNET_CHECKPOINT",
                str(Path(__file__).parent / "artifacts/face_detection_yunet.onnx"),
            ),
            "",
            (320, 320),
            0.9,
            0.3,
            5000,
        )

    def detect(self, frame):
        h, w = frame.shape[:2]
        scale = min(1.0, 640 / max(h, w))
        small = cv2.resize(frame, (max(32, int(w * scale)), max(32, int(h * scale))))
        self.net.setInputSize((small.shape[1], small.shape[0]))
        _, found = self.net.detect(small)
        boxes = []
        if found is None:
            return boxes
        for row in found:
            x, y, bw, bh = row[:4] / scale
            pts = row[4:14].reshape(5, 2) / scale
            eyes = pts[:2]
            mouth = pts[3:]
            distance = np.linalg.norm(eyes[0] - eyes[1])
            if min(bw, bh) < 50 or not 0.45 < bw / bh < 1.7:
                continue
            if not 0.12 * bw < distance < 0.8 * bw:
                continue
            if mouth[:, 1].mean() <= eyes[:, 1].mean() + 0.08 * bh:
                continue
            if not all(
                x - 0.1 * bw <= p[0] <= x + 1.1 * bw
                and y - 0.1 * bh <= p[1] <= y + 1.1 * bh
                for p in pts
            ):
                continue
            boxes.append(
                np.array(
                    [
                        max(0, int(x)),
                        max(0, int(y)),
                        min(int(bw), w - max(0, int(x))),
                        min(int(bh), h - max(0, int(y))),
                    ]
                )
            )
        return boxes

    def orient(self, frame):
        for code in [
            None,
            cv2.ROTATE_90_CLOCKWISE,
            cv2.ROTATE_90_COUNTERCLOCKWISE,
            cv2.ROTATE_180,
        ]:
            im = frame if code is None else cv2.rotate(frame, code)
            boxes = self.detect(im)
            if boxes:
                return code
        return None


def crop_face(frame, box):
    x, y, w, h = map(int, box)
    side = int(max(w, h) * 1.4)
    cx = x + w // 2
    cy = y + h // 2
    left = cx - side // 2
    top = cy - side // 2
    right = left + side
    bottom = top + side
    pad = [
        max(0, -top),
        max(0, bottom - frame.shape[0]),
        max(0, -left),
        max(0, right - frame.shape[1]),
    ]
    padded = cv2.copyMakeBorder(frame, *pad, cv2.BORDER_REPLICATE)
    top += pad[0]
    left += pad[2]
    return padded[top : top + side, left : left + side]
