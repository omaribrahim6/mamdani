// Mirrors lib/categories.ts in the Next app: label, road-crew stencil and APWA utility colour.
export type CategoryId =
  | 'pothole' | 'sidewalk' | 'streetlight' | 'traffic' | 'bike_lane' | 'water'
  | 'drainage' | 'waste' | 'graffiti' | 'tree' | 'other';

export interface CategoryInfo { label: string; stencil: string; color: string }

export const CATEGORIES: Record<CategoryId, CategoryInfo> = {
  pothole: { label: 'Pothole', stencil: 'POTHOLE', color: '#FF6A13' },
  sidewalk: { label: 'Broken sidewalk', stencil: 'SIDEWALK', color: '#FF2E88' },
  streetlight: { label: 'Streetlight out', stencil: 'LIGHT OUT', color: '#E0302B' },
  traffic: { label: 'Signal or sign', stencil: 'SIGNAL', color: '#8A3FD6' },
  bike_lane: { label: 'Blocked bike lane', stencil: 'BIKE LANE', color: '#8A3FD6' },
  water: { label: 'Water problem', stencil: 'WATER', color: '#1C6DD8' },
  drainage: { label: 'Flooding or drain', stencil: 'DRAIN', color: '#12995A' },
  waste: { label: 'Garbage', stencil: 'GARBAGE', color: '#E8A800' },
  graffiti: { label: 'Graffiti', stencil: 'GRAFFITI', color: '#E8A800' },
  tree: { label: 'Tree or park', stencil: 'TREE', color: '#12995A' },
  other: { label: 'Something else', stencil: 'CHECK', color: '#6E7479' },
};

export const category = (id: string): CategoryInfo => CATEGORIES[id as CategoryId] ?? CATEGORIES.other;
