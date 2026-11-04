"""Bounded full-image window scores; independent from the released classifier score."""
import math
import numpy as np
from PIL import Image


def positions(length, window=336, stride=168):
    if length <= window:
        return [0]
    count = math.ceil((length-window)/stride)
    return [round(i*(length-window)/count) for i in range(count+1)]


def full_image_distribution(image, predictor):
    source_size = image.size
    image = image.convert('RGB').copy()
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    w, h = image.size
    boxes, tiles = [], []
    for y in positions(h):
        for x in positions(w):
            box = (x, y, min(w, x+336), min(h, y+336))
            tile = image.crop(box)
            if tile.size != (336, 336):
                padded = Image.new('RGB', (336, 336))
                padded.paste(tile, ((336-tile.width)//2, (336-tile.height)//2))
                tile = padded
            boxes.append(box)
            tiles.append(tile)
    rows = predictor.predict(tiles, batch_size=4)
    if len(rows) != len(boxes):
        raise ValueError('incomplete_window_predictions')
    total = np.zeros((h, w), dtype=np.float32)
    weights = np.zeros_like(total)
    windows = []
    for box, row in zip(boxes, rows):
        x, y, right, bottom = box
        score = float(row['fake_probability'])
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('invalid_window_score')
        # A positive floor preserves full coverage, including image corners.
        wx = .1 + .9*np.sin(np.pi*(np.arange(right-x)+.5)/(right-x))**2
        wy = .1 + .9*np.sin(np.pi*(np.arange(bottom-y)+.5)/(bottom-y))**2
        weight = wy[:, None]*wx[None, :]
        total[y:bottom, x:right] += score*weight
        weights[y:bottom, x:right] += weight
        windows.append({'analysisBox':list(box), 'sourceBox':[round(x*source_size[0]/w), round(y*source_size[1]/h), round(right*source_size[0]/w), round(bottom*source_size[1]/h)], 'score':score, 'logit':row.get('logit')})
    if not np.all(weights > 0):
        raise ValueError('incomplete_spatial_coverage')
    field = np.clip(total/weights, 0, 1)
    # Fixed weak-blue to strong-rose scale; never normalize per image.
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for channel, low, high in [(0, 60, 245), (1, 130, 48), (2, 220, 112)]:
        rgba[:, :, channel] = np.rint(low+(high-low)*field).astype('uint8')
    rgba[:, :, 3] = np.rint(45+field*155).astype('uint8')
    return Image.fromarray(rgba), {'status':'completed', 'method':'overlapping_window_scores_v1', 'sourceSize':list(source_size), 'analysisSize':[w,h], 'windowSize':336, 'maximumStride':168, 'windowCount':len(windows), 'coveredFraction':1.0, 'scale':[0,1], 'windows':windows, 'meaning':'window_classification_not_pixel_segmentation', 'minimum':float(field.min()), 'maximum':float(field.max())}
