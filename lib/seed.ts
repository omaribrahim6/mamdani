import type { CategoryId } from './categories';
import type { AccessImpact, Status } from './types';

// Real Ottawa locations (geocoded), realistic issues, a city that's been reporting for two days.
export interface SeedIssue {
  category: CategoryId;
  title: string;
  summary: string;
  address: string;
  lat: number;
  lng: number;
  severity: number;
  safetyRisk: number;
  hazards: string[];
  access: [AccessImpact, string[]];
  reports: number;
  firstHoursAgo: number;
  status: Status;
  resolvedHoursAgo?: number;
}

export const SEED: SeedIssue[] = [
  {
    category: 'pothole', title: 'Deep pothole in the northbound curb lane', address: '800 Bank St, The Glebe', lat: 45.402753, lng: -75.688362,
    summary: 'Pothole about 70 cm across and 10 cm deep with a broken edge; cars are swerving into the next lane to avoid it.',
    severity: 88, safetyRisk: 76, hazards: ['tire and rim damage', 'sudden lane changes'], access: ['low', []], reports: 14, firstHoursAgo: 3.2, status: 'new',
  },
  {
    category: 'sidewalk', title: 'Heaved slab blocks the sidewalk', address: '225 Laurier Ave W, Centretown', lat: 45.422434, lng: -75.689586,
    summary: 'Sidewalk slab lifted about 4 cm across its full width next to the bus stop.',
    severity: 64, safetyRisk: 78, hazards: ['trip hazard'], access: ['critical', ['Wheelchair and walker users cannot pass the 4 cm lip', 'Only detour is into a live traffic lane']], reports: 4, firstHoursAgo: 26, status: 'assigned',
  },
  {
    category: 'bike_lane', title: 'Delivery trucks parked in the bike lane', address: "150 O'Connor St, Centretown", lat: 45.414612, lng: -75.692942,
    summary: 'Vehicles repeatedly stopping inside the protected bike lane during the lunch rush, forcing cyclists into traffic.',
    severity: 52, safetyRisk: 72, hazards: ['cyclists merge into traffic'], access: ['none', []], reports: 9, firstHoursAgo: 71, status: 'new',
  },
  {
    category: 'waste', title: 'Overflowing bins outside the market', address: '100 Rideau St, ByWard Market', lat: 45.426907, lng: -75.690084,
    summary: 'Three public bins full with bags piled on the sidewalk beside them.',
    severity: 41, safetyRisk: 18, hazards: ['litter in the roadway'], access: ['moderate', ['Bags narrow the sidewalk to about 80 cm']], reports: 6, firstHoursAgo: 5.5, status: 'in_progress',
  },
  {
    category: 'streetlight', title: 'Streetlight out above the crosswalk', address: '250 Elgin St, Golden Triangle', lat: 45.417665, lng: -75.6902,
    summary: 'Luminaire dark above a marked pedestrian crossing; the crossing is unlit after sunset.',
    severity: 55, safetyRisk: 69, hazards: ['pedestrians hard to see at night'], access: ['low', ['Low-vision pedestrians lose the lit crossing']], reports: 3, firstHoursAgo: 19, status: 'new',
  },
  {
    category: 'water', title: 'Drinking fountain not working', address: 'Minto Park, Elgin St', lat: 45.41664, lng: -75.68912,
    summary: 'Park drinking fountain produces no water; basin is dry and the push button is stuck.',
    severity: 30, safetyRisk: 12, hazards: [], access: ['low', ['Only accessible-height fountain in the park']], reports: 2, firstHoursAgo: 40, status: 'new',
  },
  {
    category: 'sidewalk', title: 'Cracked and sunken sidewalk by campus', address: '75 Laurier Ave E, Sandy Hill', lat: 45.421011, lng: -75.680201,
    summary: 'Several slabs cracked and sunk up to 3 cm on a busy student walking route.',
    severity: 58, safetyRisk: 61, hazards: ['trip hazard', 'ice ponding in winter'], access: ['moderate', ['Uneven surface for wheelchair users']], reports: 5, firstHoursAgo: 30, status: 'new',
  },
  {
    category: 'drainage', title: 'Blocked catch basin, water ponding', address: '400 Preston St, Little Italy', lat: 45.411089, lng: -75.71585,
    summary: 'Catch basin covered with leaves; a pond about 3 m wide spreads across the crosswalk after rain.',
    severity: 47, safetyRisk: 44, hazards: ['splash onto pedestrians', 'ice in winter'], access: ['moderate', ['Crossing is under water at the curb cut']], reports: 2, firstHoursAgo: 12, status: 'new',
  },
  {
    category: 'traffic', title: 'Pedestrian signal head not lighting', address: '300 Dalhousie St, Lowertown', lat: 45.432796, lng: -75.694474,
    summary: 'Walk signal on the east side stays dark through the cycle.',
    severity: 60, safetyRisk: 73, hazards: ['pedestrians cross without a signal'], access: ['moderate', ['Blind pedestrians lose the audible cue if the push button is also down']], reports: 2, firstHoursAgo: 8, status: 'new',
  },
  {
    category: 'graffiti', title: 'Tagging on a heritage wall', address: '50 Clarence St, ByWard Market', lat: 45.430823, lng: -75.688865,
    summary: 'Fresh spray-paint tags across about 4 m of heritage stonework.',
    severity: 25, safetyRisk: 0, hazards: [], access: ['none', []], reports: 1, firstHoursAgo: 15, status: 'new',
  },
  {
    category: 'pothole', title: 'Pothole cluster in the left lane', address: '180 Kent St, Centretown', lat: 45.417847, lng: -75.701791,
    summary: 'Three smaller potholes in a row along a failed patch.',
    severity: 62, safetyRisk: 50, hazards: ['tire damage'], access: ['none', []], reports: 3, firstHoursAgo: 22, status: 'new',
  },
  {
    category: 'pothole', title: 'Sunken utility cut at the crossing', address: '99 Bank St, Centretown', lat: 45.420443, lng: -75.700084,
    summary: 'Patched trench has settled about 5 cm right at the pedestrian crossing.',
    severity: 70, safetyRisk: 66, hazards: ['trip hazard', 'cyclist swerve risk'], access: ['moderate', ['Lip at the curb cut catches wheelchair casters']], reports: 7, firstHoursAgo: 44, status: 'assigned',
  },
  {
    category: 'drainage', title: 'Catch basin blocked with debris', address: '500 Rideau St, Lowertown', lat: 45.428766, lng: -75.685752,
    summary: 'Grate clogged; water ponds along the curb lane.',
    severity: 40, safetyRisk: 30, hazards: ['splash onto sidewalk'], access: ['low', []], reports: 2, firstHoursAgo: 9, status: 'new',
  },
  {
    category: 'tree', title: 'Fallen branch across the sidewalk', address: '20 Mann Ave, Sandy Hill', lat: 45.419123, lng: -75.676924,
    summary: 'Large branch down after last night’s wind, blocking most of the sidewalk.',
    severity: 50, safetyRisk: 45, hazards: ['obstruction'], access: ['critical', ['Sidewalk impassable for wheelchairs and strollers']], reports: 1, firstHoursAgo: 4, status: 'new',
  },
  {
    category: 'waste', title: 'Mattress dumped on the sidewalk', address: '1 Nicholas St, Lowertown', lat: 45.426514, lng: -75.690106,
    summary: 'Mattress and a broken chair left against the building.',
    severity: 35, safetyRisk: 10, hazards: [], access: ['low', []], reports: 2, firstHoursAgo: 28, status: 'new',
  },
  {
    category: 'traffic', title: 'Stop sign knocked flat', address: '400 Wellington St, Centretown', lat: 45.423007, lng: -75.699076,
    summary: 'Stop sign post bent to the ground at the side-street approach.',
    severity: 72, safetyRisk: 80, hazards: ['uncontrolled intersection'], access: ['none', []], reports: 1, firstHoursAgo: 1.5, status: 'new',
  },
  {
    category: 'pothole', title: 'Pothole at the bus stop', address: '1050 Bank St, Old Ottawa South', lat: 45.395175, lng: -75.684227,
    summary: 'Pothole in the bus bay; buses were stopping mid-lane to avoid it.',
    severity: 68, safetyRisk: 55, hazards: [], access: ['none', []], reports: 6, firstHoursAgo: 47, status: 'resolved', resolvedHoursAgo: 20,
  },
  {
    category: 'streetlight', title: 'Streetlight flickering on and off', address: '275 Slater St, Centretown', lat: 45.418785, lng: -75.701605,
    summary: 'Luminaire cycling on and off every few seconds.',
    severity: 35, safetyRisk: 30, hazards: [], access: ['none', []], reports: 2, firstHoursAgo: 39, status: 'resolved', resolvedHoursAgo: 6,
  },
];
