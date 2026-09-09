import glob
import numpy as np
from scipy import ndimage

names = [f.replace("mask_", "").replace(".npy", "") for f in glob.glob("mask_*.npy")]
masks = {n: np.load(f"mask_{n}.npy") for n in names}

print(f"{len(names)} territories loaded")

# Report any overlapping pairs so they can be resolved by hand - an
# overlap means two territories would both claim the same board pixels.
found_overlap = False
for i, a in enumerate(names):
    for b in names[i + 1 :]:
        overlap = (masks[a] & masks[b]).sum()
        if overlap > 30:
            found_overlap = True
            print(f"OVERLAP {a} <-> {b}: {overlap}px")

# Report suspiciously tiny masks (likely a failed seed).
for n in names:
    px = masks[n].sum()
    if px < 300:
        print(f"TINY {n}: {px}px")

if not found_overlap:
    print("no significant overlaps")
