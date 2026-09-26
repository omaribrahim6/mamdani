import type { ReportViewModel } from './types';

export const mockReports: ReportViewModel[] = [
  {
    id: 'CW-2418',
    title: 'Sidewalk uplift blocking curb access',
    summary: 'Two concrete panels have lifted beside the east curb ramp. Wheelchairs and strollers are being diverted into the cycle lane to pass.',
    category: 'Accessibility', status: 'Crew assigned', priority: 'Urgent',
    address: 'Dundas St W & Gladstone Ave', coordinates: [-79.4349, 43.6496], reportedAt: 'Today, 14:42',
    media: [
      { id: '2418-a', imageUrl: 'https://images.unsplash.com/photo-1595877244574-e90ce41ce089?auto=format&fit=crop&w=1400&q=85', alt: 'Raised concrete sidewalk panels beside a city street' },
      { id: '2418-b', imageUrl: 'https://images.unsplash.com/photo-1526721940322-10fb6e3ae94a?auto=format&fit=crop&w=1400&q=85', alt: 'Close view of damaged concrete near a curb' },
    ],
    details: [
      { label: 'Report source', value: '311 mobile intake' }, { label: 'Assigned team', value: 'District 4 · Concrete crew' },
      { label: 'Service target', value: '4 hours' }, { label: 'Reference', value: 'A11Y-2026-0831' },
    ],
  },
  {
    id: 'CW-2413', title: 'Pedestrian signal remains dark',
    summary: 'The northbound walk signal does not illuminate during either phase. The audible signal is still operating.',
    category: 'Traffic signal', status: 'In progress', priority: 'Urgent',
    address: 'Parliament St & Carlton St', coordinates: [-79.3671, 43.6637], reportedAt: 'Today, 14:18',
    media: [{ id: '2413-a', imageUrl: 'https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?auto=format&fit=crop&w=1400&q=85', alt: 'Pedestrian crossing signal at a downtown intersection' }],
    details: [
      { label: 'Report source', value: 'Call centre' }, { label: 'Assigned team', value: 'Signals response 12' },
      { label: 'Service target', value: '2 hours' }, { label: 'Reference', value: 'SIG-2026-1440' },
    ],
  },
  {
    id: 'CW-2409', title: 'Deep pothole across eastbound lane',
    summary: 'A wide pavement failure is forcing drivers to cross the centre line. Loose asphalt is collecting along the curb.',
    category: 'Road surface', status: 'Triaged', priority: 'High',
    address: 'Queen St E & Coxwell Ave', coordinates: [-79.3206, 43.6687], reportedAt: 'Today, 13:51',
    media: [
      { id: '2409-a', imageUrl: 'https://images.unsplash.com/photo-1561008526-0d270d018f36?auto=format&fit=crop&w=1400&q=85', alt: 'Damaged asphalt in a travelled road lane' },
      { id: '2409-b', imageUrl: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?auto=format&fit=crop&w=1400&q=85', alt: 'Street-level view of rough road pavement' },
    ],
    details: [
      { label: 'Report source', value: 'Resident web form' }, { label: 'Assigned team', value: 'Awaiting dispatch' },
      { label: 'Service target', value: '24 hours' }, { label: 'Reference', value: 'ROAD-2026-3912' },
    ],
  },
  {
    id: 'CW-2402', title: 'Overflowing bins at transit stop',
    summary: 'Three public litter bins are full and debris is spreading into the bus boarding area.',
    category: 'Waste', status: 'Crew assigned', priority: 'Standard',
    address: 'Bloor St W & Lansdowne Ave', coordinates: [-79.4427, 43.6582], reportedAt: 'Today, 12:37',
    media: [{ id: '2402-a', imageUrl: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=1400&q=85', alt: 'Public litter bin beside a city sidewalk' }],
    details: [
      { label: 'Report source', value: 'TTC station staff' }, { label: 'Assigned team', value: 'Litter operations west' },
      { label: 'Service target', value: '12 hours' }, { label: 'Reference', value: 'WST-2026-1198' },
    ],
  },
  {
    id: 'CW-2397', title: 'Streetlight cycling on and off',
    summary: 'The fixture above the south sidewalk cycles every few minutes, leaving the block unlit between intervals.',
    category: 'Street lighting', status: 'New', priority: 'Standard',
    address: 'Geary Ave & Ossington Ave', coordinates: [-79.4258, 43.6704], reportedAt: 'Today, 11:54', media: [],
    details: [
      { label: 'Report source', value: '311 mobile intake' }, { label: 'Assigned team', value: 'Unassigned' },
      { label: 'Service target', value: '3 days' }, { label: 'Reference', value: 'LGT-2026-2214' },
    ],
  },
  {
    id: 'CW-2388', title: 'Storm drain obstructed by debris',
    summary: 'Leaves and construction material cover the catch basin. Water is pooling along the curb after rainfall.',
    category: 'Drainage', status: 'Triaged', priority: 'High',
    address: 'King St E & River St', coordinates: [-79.3598, 43.6567], reportedAt: 'Today, 10:26',
    media: [{ id: '2388-a', imageUrl: 'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=1400&q=85', alt: 'Rain water collecting along the side of a street' }],
    details: [
      { label: 'Report source', value: 'Field inspector' }, { label: 'Assigned team', value: 'District 1 drainage' },
      { label: 'Service target', value: '8 hours' }, { label: 'Reference', value: 'DRN-2026-0875' },
    ],
  },
];
