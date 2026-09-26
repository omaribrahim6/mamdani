export type ReportStatus = 'New' | 'Triaged' | 'Crew assigned' | 'In progress';
export type ReportPriority = 'Urgent' | 'High' | 'Standard';

export interface ReportMedia {
  id: string;
  imageUrl: string;
  alt: string;
}

export interface ReportDetailRow {
  label: string;
  value: string;
}

export interface ReportViewModel {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: ReportStatus;
  priority: ReportPriority;
  address: string;
  coordinates: [lng: number, lat: number];
  reportedAt: string;
  media: ReportMedia[];
  details: ReportDetailRow[];
}
