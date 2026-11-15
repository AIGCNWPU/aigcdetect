"""Select presentation frames, excluding encoded decoder references outside the clip."""
import math


def visible_frame_indices(reader):
    encoded_count = len(reader)
    if not 2 <= encoded_count <= 200000:
        raise ValueError('Invalid encoded frame count')
    timestamps = reader.get_frame_timestamp(list(range(encoded_count)))
    duration = float(timestamps[-1][1])
    if not math.isfinite(duration) or not 0 < duration <= 600.5:
        raise ValueError('Invalid visible video duration')
    indices = []
    previous = -math.inf
    for index, pair in enumerate(timestamps):
        start, end = float(pair[0]), float(pair[1])
        # Some valid codecs omit packet duration (end == start); presentation
        # starts still identify the visible sequence, including the next frame.
        if not math.isfinite(start) or not math.isfinite(end) or end < start:
            raise ValueError('Invalid frame presentation timestamps')
        if start < 0 or start >= duration:
            continue
        if start <= previous:
            raise ValueError('Presentation timestamps must be strictly increasing')
        indices.append(index)
        previous = start
    if len(indices) < 2:
        raise ValueError('Not enough visible video frames')
    return indices, duration
