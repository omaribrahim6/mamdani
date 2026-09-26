import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { registerMayorModel, type ModelKind } from '../../components/mayor/models';

// Mamdani's generated 3D models (Tripo, rigged), baked to .mrig by scripts/bake-mamdani.ts.
// Loaded once at startup; if anything fails, the procedural Mamdani stands in.
const SOURCES: Record<ModelKind, number> = {
  suit: require('../assets/models/mamdani-suit.mrig'),
  construction: require('../assets/models/mamdani-construction.mrig'),
};

async function bytes(mod: number): Promise<ArrayBuffer> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (Platform.OS === 'web') return (await fetch(uri)).arrayBuffer();
  return new File(uri).arrayBuffer();
}

export async function loadMayorModels() {
  await Promise.all(
    (Object.keys(SOURCES) as ModelKind[]).map(async (kind) => {
      try {
        registerMayorModel(kind, await bytes(SOURCES[kind]));
      } catch (e) {
        console.warn(`Mamdani ${kind} model didn’t load; using the built-in one`, e);
      }
    }),
  );
}
