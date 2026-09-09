# Seed points + a bounding-box crop (image pixel coords) per territory.
# The crop is what actually makes this robust: flood-fill is run only
# within the box, so a leak can never escape into the globally-connected
# ocean and swallow half the map - it just hits the box edge instead. Boxes
# are generous but stop short of neighboring territories where possible.
# format: name -> (seed_x, seed_y, x0, y0, x1, y1)
SEEDS = {
    # North America
    "alaska": (80, 140, 20, 60, 150, 220),
    "northwest-territory": (185, 150, 60, 60, 280, 210),
    "greenland": (420, 100, 350, 40, 480, 180),
    "alberta": (195, 220, 140, 160, 260, 260),
    "ontario": (250, 245, 220, 170, 310, 290),
    "quebec": (320, 230, 280, 170, 360, 290),
    "western-united-states": (200, 270, 140, 240, 260, 320),
    "eastern-united-states": (290, 300, 250, 260, 340, 340),
    "central-america": (190, 340, 150, 320, 270, 430),
    # South America
    "venezuela": (270, 480, 200, 440, 340, 500),
    "brazil": (330, 540, 225, 455, 430, 660),
    "peru": (260, 555, 195, 500, 340, 625),
    "argentina": (290, 650, 210, 590, 340, 700),
    # Europe
    "iceland": (510, 160, 470, 130, 570, 220),
    "great-britain": (510, 285, 460, 230, 545, 310),
    "scandinavia": (615, 160, 560, 90, 680, 230),
    "northern-europe": (650, 260, 580, 220, 700, 300),
    "western-europe": (500, 385, 460, 350, 560, 430),
    "southern-europe": (615, 345, 560, 300, 680, 400),
    "ukraine": (700, 240, 660, 110, 800, 290),
    # Africa
    "north-africa": (580, 555, 480, 470, 650, 590),
    "egypt": (660, 500, 610, 440, 710, 540),
    "east-africa": (700, 590, 660, 470, 790, 620),
    "congo": (670, 660, 580, 560, 720, 690),
    "south-africa": (650, 725, 580, 650, 720, 780),
    "madagascar": (800, 695, 770, 650, 830, 740),
    # Asia
    "ural": (850, 215, 790, 140, 900, 290),
    "siberia": (985, 120, 900, 50, 1060, 190),
    "yakutsk": (1015, 95, 960, 30, 1070, 150),
    "kamchatka": (1115, 100, 1060, 30, 1200, 220),
    "irkutsk": (1015, 215, 950, 150, 1080, 270),
    "mongolia": (1000, 270, 930, 230, 1090, 330),
    "japan": (1150, 300, 1100, 240, 1210, 360),
    "china": (975, 350, 900, 290, 1060, 420),
    "afghanistan": (810, 330, 770, 260, 860, 360),
    "middle-east": (770, 395, 660, 350, 850, 460),
    "india": (880, 425, 830, 380, 940, 480),
    "siam": (1000, 460, 940, 410, 1050, 500),
    # Australia
    "indonesia": (980, 615, 900, 540, 1060, 660),
    "new-guinea": (1075, 585, 1040, 540, 1150, 630),
    "western-australia": (1010, 720, 960, 650, 1075, 800),
    "eastern-australia": (1140, 690, 1075, 600, 1210, 760),
}
