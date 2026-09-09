"""One consolidated pipeline: base flood-fill segmentation from seeds.py,
then the specific hand-found fixes for territories the base pass gets
wrong (label callouts, missing hand-drawn borders, scattered archipelagos).
Rerun this top-to-bottom instead of hand-patching masks interactively -
it's the reproducible record of every fix that was needed."""

import numpy as np
from scipy import ndimage
from PIL import Image
from skimage import color, filters
from skimage.segmentation import flood
from seeds import SEEDS

im = Image.open("risk_map_source.png").convert("RGB")
rgb = np.array(im)
arr = rgb.astype(np.float64) / 255.0
blurred = filters.gaussian(arr, sigma=1.0, channel_axis=-1)
lab = color.rgb2lab(blurred)
H, W = lab.shape[:2]


def flood_box(seed_xy, box, tol):
    x0, y0, x1, y1 = box
    sub = lab[y0:y1, x0:x1]
    sx, sy = seed_xy
    seed_color = sub[sy - y0, sx - x0]
    dist = np.sqrt(((sub - seed_color) ** 2).sum(axis=-1))
    local = flood(dist, (sy - y0, sx - x0), tolerance=tol)
    full = np.zeros((H, W), dtype=bool)
    full[y0:y1, x0:x1] = local
    return full


def purple_blob(box, min_size=12):
    """Color-threshold fallback for the small purple 'bubble' territories
    (Iceland/Indonesia/New Guinea) where the seed keeps landing on the
    white label-callout box instead of the fill, and flood-fill only
    ever finds a thin ring around the text."""
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1].astype(int)
    mask = (sub[:, :, 0] - sub[:, :, 1] > 4) & (sub[:, :, 2] - sub[:, :, 1] > 4) & (sub[:, :, 1] < 225) & (sub[:, :, 1] > 60)
    labeled, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, labeled, range(1, n + 1))
    keep = np.zeros_like(mask)
    for i, s in enumerate(sizes, start=1):
        if s >= min_size:
            keep |= labeled == i
    keep = ndimage.binary_closing(keep, structure=np.ones((3, 3)))
    full = np.zeros((H, W), dtype=bool)
    full[y0:y1, x0:x1] = keep
    return full


TOL = 15
TOL_OVERRIDES = {"brazil": 17, "peru": 17, "central-america": 18, "iceland": 13}
# Small islands where flood-fill only ever finds a thin ring around the
# label callout, never the interior - the ring is a closed loop though, so
# filling it solid afterward is a safe, exact fix (not the case for the
# open-boundary leaks elsewhere in this file).
FILL_HOLES_AFTER = {"iceland"}
SEED_OVERRIDES = {"central-america": (200, 420, 100, 355, 270, 460)}
COLOR_THRESHOLD = {"indonesia": (900, 540, 1060, 660), "new-guinea": (1030, 540, 1160, 640)}

masks = {}
for name, seed_box in SEEDS.items():
    if name in COLOR_THRESHOLD:
        continue
    sx, sy, x0, y0, x1, y1 = SEED_OVERRIDES.get(name, seed_box)
    tol = TOL_OVERRIDES.get(name, TOL)
    m = flood_box((sx, sy), (x0, y0, x1, y1), tol)
    if name in FILL_HOLES_AFTER:
        m = ndimage.binary_fill_holes(m)
    masks[name] = m

for name, box in COLOR_THRESHOLD.items():
    m = purple_blob(box)
    if name == "iceland":
        m = ndimage.binary_fill_holes(m)
    masks[name] = m

# Whole-Australia flood + manual west/east split - the two states have no
# drawn interior boundary strong enough for flood-fill alone; the outer
# coastline does, so fill that ring solid and cut it with a vertical line
# matched by eye to the drawn border.
whole_australia = ndimage.binary_fill_holes(flood_box((1010, 720), (960, 650, 1210, 800), 15))
aus_split_x = 1050
west = whole_australia.copy()
west[:, aus_split_x:] = False
east = whole_australia.copy()
east[:, :aus_split_x] = False
masks["western-australia"] = west
masks["eastern-australia"] = east

# Peru/Brazil: legitimate small overlap where flood-fill jumped a thin
# river line too far on one side - Brazil (the interior/main mass) wins.
masks["peru"] = masks["peru"] & ~masks["brazil"]

# Generic cleanup pass for every other overlapping pair (adjacent same-color
# territories whose flood-fills grew into each other by a few hundred/
# thousand px along a shared, imperfectly-bounded edge). No principled way
# to know which side "should" win a given contested pixel here, so the
# consistent rule is: the smaller territory keeps the contested pixels,
# since losing a chunk hurts a small territory's shape more than trimming
# it off a big one.
names = list(masks.keys())
for i, a in enumerate(names):
    for b in names[i + 1 :]:
        overlap = masks[a] & masks[b]
        if overlap.sum() < 30:
            continue
        if masks[a].sum() <= masks[b].sum():
            masks[b] = masks[b] & ~overlap
        else:
            masks[a] = masks[a] & ~overlap

for name, m in masks.items():
    np.save(f"mask_{name}.npy", m)

print(f"saved {len(masks)} masks")
