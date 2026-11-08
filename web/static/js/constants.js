export const GRID = { w: 53, h: 28 };
export const SCALE = { x: 16.5, y: 27.5 };
export const MARGIN = 32;
export const VIEW_W = GRID.w * SCALE.x + MARGIN * 2;
export const VIEW_H = GRID.h * SCALE.y + MARGIN * 2;

export const ROOMS = [
  { name: "Bad Groß", points: [[0, 0], [13, 0], [13, 4], [0, 4]], label: [1.1, 1.35] },
  { name: "Küche", points: [[0, 4], [13, 4], [13, 10], [0, 10]], label: [1.1, 4.9] },
  { name: "Wohnzimmer", points: [[0, 10], [13, 10], [13, 14], [37, 14], [37, 18], [18, 18], [18, 20], [0, 20]], label: [1.1, 11.2] },
  { name: "Schlafzimmer", points: [[37, 14], [53, 14], [53, 18], [37, 18]], label: [38.2, 15.15] },
  { name: "Flur", points: [[18, 18], [53, 18], [53, 20], [18, 20]], label: [34.0, 19.25] },
  { name: "Arbeitszimmer", points: [[0, 20], [18, 20], [18, 28], [0, 28]], label: [1.1, 21.35] },
  { name: "Bad Klein", points: [[38, 20], [53, 20], [53, 24], [38, 24]], label: [39.2, 21.25] },
  { name: "Gästezimmer", points: [[18, 20], [38, 20], [38, 24], [53, 24], [53, 28], [18, 28]], label: [19.2, 21.35] },
];

export const APARTMENT_OUTLINE = [
  [0, 0], [13, 0], [13, 14], [53, 14], [53, 28], [0, 28],
];

export const SLOT_POS = {
  "1": [9.2, 2.55],
  A: [4.0, 7.7],
  "2": [10.2, 7.7],
  B: [4.8, 14.5],
  "3": [18.2, 16.25],
  "4": [28.2, 16.25],
  "5": [45.5, 16.25],
  "9": [46.2, 22.35],
  C: [14.8, 24.4],
  D: [22.2, 22.7],
  "6": [7.5, 25.9],
  "7": [28.5, 25.9],
  "8": [46.2, 25.9],
};

export const SLOTS = {
  "1": {"kind": "thermostat", "room": "Bad Groß", "location": "Bad Groß", "mac": "DC:62:79:90:73:AD"},
  "2": {"kind": "thermostat", "room": "Küche", "location": "Küche", "mac": "B0:19:21:1B:A7:40"},
  "3": {"kind": "thermostat", "room": "Wohnzimmer", "location": "Wohnzimmer Links", "mac": "3C:64:CF:62:BA:DF"},
  "4": {"kind": "thermostat", "room": "Wohnzimmer", "location": "Wohnzimmer Rechts", "mac": "B0:19:21:1B:A4:BC"},
  "5": {"kind": "thermostat", "room": "Schlafzimmer", "location": "Schlafzimmer", "mac": "3C:64:CF:62:96:B6"},
  "6": {"kind": "thermostat", "room": "Arbeitszimmer", "location": "Arbeitszimmer", "mac": "30:DE:4B:A9:88:6B"},
  "7": {"kind": "thermostat", "room": "Gästezimmer", "location": "Gästezimmer Rechts", "mac": "DC:62:79:90:73:1B"},
  "8": {"kind": "thermostat", "room": "Gästezimmer", "location": "Gästezimmer Links", "mac": "DC:62:79:71:3B:CF"},
  "9": {"kind": "thermostat", "room": "Bad Klein", "location": "Bad Klein", "mac": "DC:62:79:90:75:F2"},
  "A": {"kind": "sensor", "room": "Küche", "location": "Küche", "mac": "DC:62:79:54:B9:E2"},
  "B": {"kind": "sensor", "room": "Wohnzimmer", "location": "Wohnzimmer", "mac": "8C:90:2D:50:35:B4"},
  "C": {"kind": "sensor", "room": "Arbeitszimmer", "location": "Arbeitszimmer", "mac": "0C:EF:15:D9:6D:DD"},
  "D": {"kind": "sensor", "room": "Gästezimmer", "location": "Gästezimmer", "mac": "0C:EF:15:F7:A7:AE"},
};

export const MAC_LOOKUP = Object.fromEntries(
  Object.entries(SLOTS).filter(([_, meta]) => meta.mac).map(([slot, meta]) => [meta.mac.toUpperCase(), slot])
);
export const LOOKUP = Object.fromEntries(
  Object.entries(SLOTS).map(([slot, meta]) => [[meta.kind, meta.location], slot])
);
