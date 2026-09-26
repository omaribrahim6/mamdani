import AsyncStorage from '@react-native-async-storage/async-storage';

// Reports this phone has sent, so residents can follow them all the way to "Fixed".
export interface MyReport {
  issueId: number;
  title: string;
  category: string;
  address: string;
  at: number;
  duplicate: boolean;
  /** the evidence photo on this phone (cache; may be cleared by the OS) */
  photoUri?: string;
}

const KEY = 'mamdani.reports';

export async function loadMine(): Promise<MyReport[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
  } catch {
    return [];
  }
}

export async function saveMine(r: MyReport) {
  try {
    const all = [r, ...(await loadMine()).filter((x) => x.issueId !== r.issueId)].slice(0, 50);
    await AsyncStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* tracking just won't persist */
  }
}
