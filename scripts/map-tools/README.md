# Illustrated map pipeline

Turns `risk_map_source.png` (the hand-illustrated board) into
`public/illustratedMap.json` (one SVG path + label centroid per territory,
in the image's own pixel space) and `public/risk_map.jpg` (a compressed
copy of the source used as the board's background image).

The image has each territory's fill baked in as flat art with no machine-
readable region data, so this recovers per-territory shapes via color-
based flood-fill segmentation (`skimage.segmentation.flood`) seeded from
one point per territory, then traces + simplifies the result into SVG
paths (`skimage.measure.find_contours` + `shapely`).

## Rerunning it

```
pip install -r requirements.txt
python build_masks.py    # flood-fill every territory -> mask_<name>.npy
python finalize.py       # sanity check: reports overlaps / suspiciously tiny masks
python visualize.py      # renders masks_preview.png - eyeball it before extracting
python extract_svg.py    # masks -> public/illustratedMap.json
```

`seeds.py` holds one (seed point, bounding box) per territory - the box is
what keeps a flood-fill from leaking across the whole connected ocean if a
seed lands somewhere the ink boundary is thin or broken. `build_masks.py`
also documents every territory-specific fix that was needed on top of the
base flood-fill (wrong seed landed on a text label, two territories with
no drawn border between them, a scattered archipelago flood-fill couldn't
reach in one pass, etc.) - if the source art changes, expect to redo a few
of those by hand the same way, using `finalize.py`'s overlap/tiny-mask
report and a debug crop (base image + mask overlay, zoomed in) to see what
went wrong.

`mask_*.npy` (per-territory boolean arrays) and `masks_preview.png` are
build output, not committed.
