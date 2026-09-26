// Same street-crew palette and type as the web app (app/globals.css).

export const C = {
  asphalt: '#26292c',
  asphalt2: '#33373b',
  curb: '#5b6166',
  concrete: '#d9d7d1',
  paper: '#f3f2ee',
  paperLine: '#d6d3cb',
  survey: '#ff2e88',
  hivis: '#ff6a13',
  hardhat: '#ffc61a',
  ok: '#12995a',
  stampRed: '#c8102e',
  access: '#1c6dd8',
};

export const F = {
  stencil: 'BigShouldersStencil_800ExtraBold',
  stencilBlack: 'BigShouldersStencil_900Black',
  ui: 'Overpass_400Regular',
  uiSemi: 'Overpass_600SemiBold',
  uiBold: 'Overpass_700Bold',
  uiBlack: 'Overpass_800ExtraBold',
};

export const FONTS = {
  [F.stencil]: require('@expo-google-fonts/big-shoulders-stencil/800ExtraBold/BigShouldersStencil_800ExtraBold.ttf'),
  [F.stencilBlack]: require('@expo-google-fonts/big-shoulders-stencil/900Black/BigShouldersStencil_900Black.ttf'),
  [F.ui]: require('@expo-google-fonts/overpass/400Regular/Overpass_400Regular.ttf'),
  [F.uiSemi]: require('@expo-google-fonts/overpass/600SemiBold/Overpass_600SemiBold.ttf'),
  [F.uiBold]: require('@expo-google-fonts/overpass/700Bold/Overpass_700Bold.ttf'),
  [F.uiBlack]: require('@expo-google-fonts/overpass/800ExtraBold/Overpass_800ExtraBold.ttf'),
};

/** type scale, px (the web uses rem on a 16px root) */
export const T = { xs: 12, sm: 14, md: 16, lg: 20, xl: 25, x2: 31, x3: 39 };
