import type { ExpoConfig } from 'expo/config';
import { backendUrl } from './src/env.cjs';

const localServer = backendUrl(process.env.EXPO_PUBLIC_BACKEND_URL).startsWith('http://');
const config: ExpoConfig = {
  name: 'Mamdani', slug: 'mamdani-mobile', version: '1.0.0', orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: { bundleIdentifier: 'com.mamdani.reporting', supportsTablet: false,
    infoPlist: localServer ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: true } } : {} },
  android: { package: 'com.mamdani.reporting' },
  plugins: [
    'expo-status-bar',
    'expo-system-ui',
    ['expo-build-properties', { android: { usesCleartextTraffic: localServer } }],
    ['expo-camera', { cameraPermission: 'Show the issue you want to report.', recordAudioAndroid: false }],
    ['expo-location', { locationWhenInUsePermission: 'Attach your current location to the issue report.' }],
    ['react-native-audio-api', { iosMicrophonePermission: 'Describe the issue using your voice.',
      iosBackgroundMode: false, androidPermissions: ['android.permission.RECORD_AUDIO'], androidForegroundService: false }],
  ],
};
export default config;
