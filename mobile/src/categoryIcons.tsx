import type { ComponentType } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { CategoryId } from '../../lib/categories';

// The category icons Mamdani Command shows (lucide, ISC licence), drawn with react-native-svg so the
// phone and the dashboard use the same symbols. Generated from lucide-react's icon data.

const TAGS = { Circle: Circle, Path: Path, Rect: Rect } as unknown as Record<string, ComponentType<Record<string, string | number>>>;

const NODES: Record<CategoryId, Array<[string, Record<string, string>]>> = {
  "pothole": [
    [
      "Rect",
      {
        "x": "2",
        "y": "6",
        "width": "20",
        "height": "8",
        "rx": "1"
      }
    ],
    [
      "Path",
      {
        "d": "M17 14v7"
      }
    ],
    [
      "Path",
      {
        "d": "M7 14v7"
      }
    ],
    [
      "Path",
      {
        "d": "M17 3v3"
      }
    ],
    [
      "Path",
      {
        "d": "M7 3v3"
      }
    ],
    [
      "Path",
      {
        "d": "M10 14 2.3 6.3"
      }
    ],
    [
      "Path",
      {
        "d": "m14 6 7.7 7.7"
      }
    ],
    [
      "Path",
      {
        "d": "m8 6 8 8"
      }
    ]
  ],
  "sidewalk": [
    [
      "Path",
      {
        "d": "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"
      }
    ],
    [
      "Path",
      {
        "d": "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"
      }
    ],
    [
      "Path",
      {
        "d": "M16 17h4"
      }
    ],
    [
      "Path",
      {
        "d": "M4 13h4"
      }
    ]
  ],
  "streetlight": [
    [
      "Path",
      {
        "d": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"
      }
    ],
    [
      "Path",
      {
        "d": "M9 18h6"
      }
    ],
    [
      "Path",
      {
        "d": "M10 22h4"
      }
    ]
  ],
  "traffic": [
    [
      "Path",
      {
        "d": "M16.05 10.966a5 2.5 0 0 1-8.1 0"
      }
    ],
    [
      "Path",
      {
        "d": "m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04"
      }
    ],
    [
      "Path",
      {
        "d": "M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z"
      }
    ],
    [
      "Path",
      {
        "d": "M9.194 6.57a5 2.5 0 0 0 5.61 0"
      }
    ]
  ],
  "bike_lane": [
    [
      "Circle",
      {
        "cx": "18.5",
        "cy": "17.5",
        "r": "3.5"
      }
    ],
    [
      "Circle",
      {
        "cx": "5.5",
        "cy": "17.5",
        "r": "3.5"
      }
    ],
    [
      "Circle",
      {
        "cx": "15",
        "cy": "5",
        "r": "1"
      }
    ],
    [
      "Path",
      {
        "d": "M12 17.5V14l-3-3 4-3 2 3h2"
      }
    ]
  ],
  "water": [
    [
      "Path",
      {
        "d": "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"
      }
    ]
  ],
  "drainage": [
    [
      "Path",
      {
        "d": "M2 12q2.5 2 5 0t5 0 5 0 5 0"
      }
    ],
    [
      "Path",
      {
        "d": "M2 19q2.5 2 5 0t5 0 5 0 5 0"
      }
    ],
    [
      "Path",
      {
        "d": "M2 5q2.5 2 5 0t5 0 5 0 5 0"
      }
    ]
  ],
  "waste": [
    [
      "Path",
      {
        "d": "M10 11v6"
      }
    ],
    [
      "Path",
      {
        "d": "M14 11v6"
      }
    ],
    [
      "Path",
      {
        "d": "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
      }
    ],
    [
      "Path",
      {
        "d": "M3 6h18"
      }
    ],
    [
      "Path",
      {
        "d": "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
      }
    ]
  ],
  "graffiti": [
    [
      "Path",
      {
        "d": "M3 3h.01"
      }
    ],
    [
      "Path",
      {
        "d": "M7 5h.01"
      }
    ],
    [
      "Path",
      {
        "d": "M11 7h.01"
      }
    ],
    [
      "Path",
      {
        "d": "M3 7h.01"
      }
    ],
    [
      "Path",
      {
        "d": "M7 9h.01"
      }
    ],
    [
      "Path",
      {
        "d": "M3 11h.01"
      }
    ],
    [
      "Rect",
      {
        "width": "4",
        "height": "4",
        "x": "15",
        "y": "5"
      }
    ],
    [
      "Path",
      {
        "d": "m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2"
      }
    ],
    [
      "Path",
      {
        "d": "m13 14 8-2"
      }
    ],
    [
      "Path",
      {
        "d": "m13 19 8-2"
      }
    ]
  ],
  "tree": [
    [
      "Path",
      {
        "d": "M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"
      }
    ],
    [
      "Path",
      {
        "d": "M7 16v6"
      }
    ],
    [
      "Path",
      {
        "d": "M13 19v3"
      }
    ],
    [
      "Path",
      {
        "d": "M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"
      }
    ]
  ],
  "other": [
    [
      "Circle",
      {
        "cx": "12",
        "cy": "12",
        "r": "10"
      }
    ],
    [
      "Path",
      {
        "d": "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
      }
    ],
    [
      "Path",
      {
        "d": "M12 17h.01"
      }
    ]
  ]
};

/** `id` is a category id; anything unknown gets the "other" icon, as on the dashboard. */
export function CategoryGlyph({ id, size = 18, color, strokeWidth = 1.8 }: { id: string; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {(NODES[id as CategoryId] ?? NODES.other).map(([tag, attrs], k) => {
        const El = TAGS[tag];
        return <El key={k} {...attrs} />;
      })}
    </Svg>
  );
}
