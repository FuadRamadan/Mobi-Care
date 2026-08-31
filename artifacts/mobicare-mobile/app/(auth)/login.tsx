import React, { useEffect, useRef, useState } from 'react';
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
import {
  confirmPatientPasswordReset,
  requestPatientPasswordReset,
} from '@workspace/api-client-react';

type Mode = 'login' | 'register' | 'recover';

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
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);

  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(
      () => setRetryAfter((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [retryAfter]);

  if (isAuthenticated) return <Redirect href="/(tabs)" />;

  const validate = (): string | null => {
    if (mode === 'recover') {
      if (phone.trim().length < 5) return 'Enter your registered phone number.';
      if (!requestId) return null;
      if (!/^\d{6}$/.test(code)) return 'Enter the six-digit verification code.';
      if (password.length < 8) return 'Password must be at least 8 characters.';
      if (password !== confirmPassword) return 'The passwords do not match.';
      return null;
    }
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
      } else if (mode === 'recover') {
        if (!requestId) {
          const result = await requestPatientPasswordReset({ phone: phone.trim() });
          setRequestId(result.requestId);
          setRetryAfter(Math.ceil(result.retryAfterSeconds));
          Alert.alert(
            'Check your messages',
            'If this number belongs to an active patient account, we sent a six-digit SMS code.',
          );
        } else {
          const resetPassword = password;
          await confirmPatientPasswordReset({
            requestId,
            code,
            newPassword: resetPassword,
          });
          setMode('login');
          setRequestId(null);
          setCode('');
          // Retain the credential only in the live sign-in form so the OS can
          // offer to save/update it. It is never written to app-managed storage.
          setPassword(resetPassword);
          setConfirmPassword('');
          Alert.alert('Password reset', 'Sign in with your new password.');
        }
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
      Alert.alert(
        mode === 'login' ? 'Login Failed' : mode === 'register' ? 'Registration Failed' : 'Password Reset Failed',
        friendly,
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setName('');
    setPhone('');
    setPassword('');
    setRequestId(null);
    setCode('');
    setConfirmPassword('');
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
        {mode !== 'recover' && <View style={s.toggleRow}>
          {(['login', 'register'] as Mode[]).map((m) => (
            <Pressable key={m} style={[s.toggleBtn, mode === m && s.toggleBtnActive]} onPress={() => switchMode(m)}>
              <Text style={[s.toggleText, mode === m && s.toggleTextActive]}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            </Pressable>
          ))}
        </View>}

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
              autoComplete="username"
              textContentType="username"
              importantForAutofill="yes"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
          </View>
          {mode === 'recover' && requestId && (
            <View style={s.field}>
              <Text style={s.label}>Six-digit verification code</Text>
              <TextInput
                style={s.input}
                value={code}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                importantForAutofill="yes"
                maxLength={6}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>
          )}
          {(mode !== 'recover' || requestId) && <View style={s.field}>
            <Text style={s.label}>{mode === 'recover' ? 'New Password' : 'Password'}</Text>
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
                textContentType={mode === 'login' ? 'password' : 'newPassword'}
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
              <Pressable style={s.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>}
          {mode === 'recover' && requestId && (
            <View style={s.field}>
              <Text style={s.label}>Confirm New Password</Text>
              <TextInput
                style={s.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repeat your new password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>
          )}

          <TouchableOpacity
            style={[s.submitBtn, loading && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={s.submitText}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : requestId ? 'Reset Password' : 'Send Verification Code'}
            </Text>
          </TouchableOpacity>
          {mode === 'login' && (
            <Pressable style={s.linkButton} onPress={() => switchMode('recover')}>
              <Text style={s.linkText}>Forgot password?</Text>
            </Pressable>
          )}
          {mode === 'recover' && (
            <View style={s.recoveryLinks}>
              <Pressable onPress={() => switchMode('login')}>
                <Text style={s.linkText}>Back to sign in</Text>
              </Pressable>
              {requestId && (
                <Pressable
                  disabled={loading || retryAfter > 0}
                  onPress={async () => {
                    setLoading(true);
                    try {
                      const result = await requestPatientPasswordReset({ phone: phone.trim() });
                      setRequestId(result.requestId);
                      setCode('');
                      setRetryAfter(Math.ceil(result.retryAfterSeconds));
                    } catch (error) {
                      Alert.alert(
                        'Could not resend code',
                        error instanceof Error ? error.message : 'Please try again later.',
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <Text style={[s.linkText, retryAfter > 0 && s.linkDisabled]}>
                    {retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend code'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
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
    linkButton: { alignItems: 'center', paddingTop: 18 },
    linkText: { fontSize: 14, fontWeight: '600', color: colors.primary },
    linkDisabled: { color: colors.mutedForeground },
    recoveryLinks: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 18 },
    disclaimer: { textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  });
}
