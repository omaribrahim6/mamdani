import type { Store } from './types';
import { memoryStore } from './memory';
import { tigerStore } from './tiger';

// Tiger Data when DATABASE_URL is set, otherwise the seeded in-memory city.
export const store: Store = process.env.DATABASE_URL ? tigerStore : memoryStore;
