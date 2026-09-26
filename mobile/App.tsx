import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CaptureScreen } from './src/CaptureScreen';
import { loadMayorModels } from './src/models';
import { FONTS } from './src/theme';

void SplashScreen.preventAutoHideAsync();

export default function App() {
  const [loaded, error] = useFonts(FONTS);
  const [models, setModels] = useState(false);

  useEffect(() => {
    void loadMayorModels().finally(() => setModels(true));
  }, []);

  const ready = (loaded || !!error) && models;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <CaptureScreen />
    </SafeAreaProvider>
  );
}
