import glob
import numpy as np
from PIL import Image

im = Image.open("../../public/risk_map.png").convert("RGB")
arr = np.array(im).astype(np.float64)
gray = arr.mean(axis=-1, keepdims=True)
base = np.repeat(gray, 3, axis=-1) * 0.5 + 128  # washed-out grayscale backdrop

colors = [
    (255, 0, 0), (0, 200, 0), (0, 100, 255), (255, 180, 0), (200, 0, 200),
    (0, 200, 200), (255, 100, 150), (120, 80, 0), (80, 0, 160), (0, 150, 80),
    (200, 200, 0), (255, 0, 120),
]

out = base.copy()
for i, path in enumerate(sorted(glob.glob("mask_*.npy"))):
    mask = np.load(path)
    c = colors[i % len(colors)]
    out[mask] = c

Image.fromarray(out.astype(np.uint8)).save("masks_preview.png")
print("saved masks_preview.png")
