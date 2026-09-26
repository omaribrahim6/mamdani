// Every issue type maps to a department, a marking colour and one of Mamdani's outfits.
// Colours follow the North American utility-marking code (APWA) wherever an infrastructure
// type has one — red is electric, blue is water, green is sewer — so the palette carries meaning.

export type CategoryId =
  | 'pothole'
  | 'sidewalk'
  | 'streetlight'
  | 'traffic'
  | 'bike_lane'
  | 'water'
  | 'drainage'
  | 'waste'
  | 'graffiti'
  | 'tree'
  | 'other';

export type Outfit = 'construction' | 'electrician' | 'sanitation' | 'inspector' | 'traffic';

export interface Category {
  id: CategoryId;
  label: string; // what a resident would call it
  stencil: string; // what the road crew paints next to it
  department: string;
  color: string;
  outfit: Outfit;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  pothole: { id: 'pothole', label: 'Pothole', stencil: 'POTHOLE', department: 'Roads Services', color: '#FF6A13', outfit: 'construction' },
  sidewalk: { id: 'sidewalk', label: 'Broken sidewalk', stencil: 'SIDEWALK', department: 'Roads Services — Sidewalks', color: '#FF2E88', outfit: 'inspector' },
  streetlight: { id: 'streetlight', label: 'Streetlight out', stencil: 'LIGHT OUT', department: 'Traffic Services — Street Lighting', color: '#E0302B', outfit: 'electrician' },
  traffic: { id: 'traffic', label: 'Signal or sign', stencil: 'SIGNAL', department: 'Traffic Services', color: '#8A3FD6', outfit: 'traffic' },
  bike_lane: { id: 'bike_lane', label: 'Blocked bike lane', stencil: 'BIKE LANE', department: 'Transportation Services', color: '#8A3FD6', outfit: 'traffic' },
  water: { id: 'water', label: 'Water problem', stencil: 'WATER', department: 'Water Services', color: '#1C6DD8', outfit: 'construction' },
  drainage: { id: 'drainage', label: 'Flooding or drain', stencil: 'DRAIN', department: 'Water Services — Drainage', color: '#12995A', outfit: 'construction' },
  waste: { id: 'waste', label: 'Garbage', stencil: 'GARBAGE', department: 'Solid Waste Services', color: '#E8A800', outfit: 'sanitation' },
  graffiti: { id: 'graffiti', label: 'Graffiti', stencil: 'GRAFFITI', department: 'By-law & Regulatory Services', color: '#E8A800', outfit: 'sanitation' },
  tree: { id: 'tree', label: 'Tree or park', stencil: 'TREE', department: 'Parks & Forestry', color: '#12995A', outfit: 'inspector' },
  other: { id: 'other', label: 'Something else', stencil: 'CHECK', department: 'ServiceOttawa 311', color: '#6E7479', outfit: 'inspector' },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

export const category = (id: string): Category => CATEGORIES[(id as CategoryId) in CATEGORIES ? (id as CategoryId) : 'other'];
