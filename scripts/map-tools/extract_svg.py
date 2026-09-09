"""Turn the final per-territory raster masks into SVG path data + label
centroids, in the source image's own pixel space (no projection needed -
this is a flat illustration, not a geographic map)."""

import json
import numpy as np
from scipy import ndimage
from skimage import measure
from shapely.geometry import Polygon
from shapely.ops import unary_union
from seeds import SEEDS

SIMPLIFY_TOLERANCE = 1.2  # px, in image space
MIN_COMPONENT_AREA = 25

paths = {}
centroids = {}

for name in SEEDS:
    mask = np.load(f"mask_{name}.npy")
    labeled, n = ndimage.label(mask)
    polys = []
    for i in range(1, n + 1):
        comp = labeled == i
        if comp.sum() < MIN_COMPONENT_AREA:
            continue
        contours = measure.find_contours(comp.astype(float), level=0.5)
        if not contours:
            continue
        # keep the outer ring only (largest contour) per component - these
        # are simple filled blobs, not shapes with real holes
        contour = max(contours, key=len)
        # contour points are (row, col) = (y, x); polygon needs (x, y)
        coords = [(pt[1], pt[0]) for pt in contour]
        if len(coords) < 4:
            continue
        poly = Polygon(coords)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            continue
        poly = poly.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
        if not poly.is_empty:
            polys.append(poly)

    if not polys:
        print(f"WARNING: no polygon for {name}")
        continue

    merged = unary_union(polys)
    geoms = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]

    d_parts = []
    for g in geoms:
        ring = list(g.exterior.coords)
        d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in ring) + " Z"
        d_parts.append(d)
    paths[name] = " ".join(d_parts)

    biggest = max(geoms, key=lambda g: g.area)
    c = biggest.centroid
    centroids[name] = [round(c.x, 1), round(c.y, 1)]

out = {"width": 1234, "height": 864, "paths": paths, "centroids": centroids}
with open("../../public/illustratedMap.json", "w") as f:
    json.dump(out, f)

print(f"wrote {len(paths)} territory paths")
