import React, { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const { login, register, isAuthenticated } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  if (isAuthenticated) return <Redirect href="/(tabs)" />;

  const validate = (): string | null => {
    if (mode === 'register' && name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (phone.trim().length < 5) return 'Enter a valid phone number.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { Alert.alert('Invalid Input', err); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(phone.trim(), password);
      } else {
        await register(name.trim(), phone.trim(), password);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      const friendly = msg.includes('401') || msg.includes('Invalid')
        ? 'Incorrect phone number or password.'
        : msg.includes('409') || msg.includes('already')
        ? 'That phone number is already registered.'
        : msg;
      Alert.alert(mode === 'login' ? 'Login Failed' : 'Registration Failed', friendly);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setName('');
    setPhone('');
    setPassword('');
  };

  const s = makeStyles(colors, insets);

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.logoBox}>
            <Ionicons name="medkit" size={32} color="#FFFFFF" />
          </View>
          <Text style={s.brandName}>MobiCare</Text>
          <Text style={s.tagline}>Medicine, delivered to your door</Text>
        </View>

        {/* Tab toggle */}
        <View style={s.toggleRow}>
          {(['login', 'register'] as Mode[]).map((m) => (
            <Pressable key={m} style={[s.toggleBtn, mode === m && s.toggleBtnActive]} onPress={() => switchMode(m)}>
              <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Form card */}
        <View style={s.card}>
          {mode === 'register' && (
            <View style={s.field}>
              <Text style={s.label}>Full Name</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
                blurOnSubmit={false}
              />
            </View>
          )}
          <View style={s.field}>
            <Text style={s.label}>Phone Number</Text>
            <TextInput
              ref={phoneRef}
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+232 76 123456"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              autoComplete="tel"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <View style={s.passwordRow}>
              <TextInput
                ref={passwordRef}
                style={[s.input, s.passwordInput]}
                value={password}
                onChangeText={setPassword}
                placeholder="Min. 8 characters"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <TouchableOpacity
            style={[s.submitBtn, loading && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>{loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.disclaimer}>Pharmacy & HQ staff use the Pharmacy Portal.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof import('@/hooks/useColors').useColors>, insets: { top: number; bottom: number }) {
  const isWeb = Platform.OS === 'web';
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.darkGreen },
    scroll: {
      flexGrow: 1,
      paddingTop: isWeb ? insets.top + 67 : insets.top + 40,
      paddingBottom: isWeb ? insets.bottom + 34 : insets.bottom + 24,
      paddingHorizontal: 24,
    },
    header: { alignItems: 'center', marginBottom: 36 },
    logoBox: {
      width: 72,
      height: 72,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
    brandName: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 },
    tagline: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderRadius: colors.radius,
      padding: 4,
      marginBottom: 20,
    },
    toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: colors.radius - 2, alignItems: 'center' },
    toggleBtnActive: { backgroundColor: '#FFFFFF' },
    toggleText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
    toggleTextActive: { color: colors.darkGreen },
    card: {
      backgroundColor: '#FFFFFF',
      borderRadius: colors.radius + 4,
      padding: 24,
      marginBottom: 20,
    },
    field: { marginBottom: 16 },
    label: { fontSize: 13, fontWeight: '600', color: colors.foreground, marginBottom: 6 },
    input: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 15,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    passwordRow: { position: 'relative' },
    passwordInput: { paddingRight: 46 },
    eyeBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 4 },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 4,
    },
    submitBtnDisabled: { opacity: 0.6 },
    submitText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    disclaimer: { textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  });
}
