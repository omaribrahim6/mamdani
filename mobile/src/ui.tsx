import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { C, F, T } from './theme';

export function Button({
  children,
  onPress,
  variant = 'plain',
  style,
  label,
}: {
  children: string;
  onPress: () => void;
  variant?: 'plain' | 'primary' | 'ghost';
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? children}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        pressed && { transform: [{ translateY: 1 }, { scale: 0.99 }], opacity: 0.92 },
        style,
      ]}
    >
      <Text style={[styles.text, variant === 'primary' && { color: C.paper }]} numberOfLines={1} adjustsFontSizeToFit>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.asphalt,
    backgroundColor: C.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: C.asphalt },
  ghost: { backgroundColor: 'transparent' },
  text: { fontFamily: F.uiBold, fontSize: T.sm, color: C.asphalt, paddingTop: 2 },
});

export function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill={C.survey} />
      <Circle cx={12} cy={10} r={2.6} fill={C.asphalt} />
    </Svg>
  );
}

export function GalleryIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={C.paper} strokeWidth={2} strokeLinecap="round">
      <Rect x={3} y={4} width={18} height={16} rx={2} />
      <Circle cx={9} cy={10} r={2} />
      <Path d="M21 16l-5-5-8 9" />
    </Svg>
  );
}

export function FlipIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={C.paper} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9a8 8 0 0 1 14.3-3.2L20 8" />
      <Path d="M20 3v5h-5" />
      <Path d="M20 15a8 8 0 0 1-14.3 3.2L4 16" />
      <Path d="M4 21v-5h5" />
    </Svg>
  );
}
