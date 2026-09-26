export type IssueStatus = 'new' | 'assigned' | 'in_progress' | 'resolved';

export interface Issue {
  id: number;
  category: string;
  title: string;
  address: string;
  severity: number;
  department: string;
  status: IssueStatus;
  reports: number;
  updatedAt: number;
  priority: number;
}

export interface CityStats {
  openCount: number;
  resolvedToday: number;
  medianHoursToFix: number | null;
  accessibilityOpen: number;
  byCategory: Array<{ category: string; open: number }>;
}
