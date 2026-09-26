import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CaptureScreen } from './src/CaptureScreen';
import { FONTS } from './src/theme';

void SplashScreen.preventAutoHideAsync();

export default function App() {
  const [loaded, error] = useFonts(FONTS);

  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <CaptureScreen />
    </SafeAreaProvider>
  );
}
