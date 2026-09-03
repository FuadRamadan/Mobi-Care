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
import { MobiCareLogo } from '@/components/MobiCareLogo';
import {
  requestPatientEmailPasswordReset,
  resetPatientEmailPassword,
  verifyPatientEmailPasswordResetOtp,
} from '@workspace/api-client-react';

type Mode = 'login' | 'register' | 'recover';
type RecoveryStage = 'email' | 'otp' | 'password';

const DEFAULT_PASSWORD_POLICY = {
  minPasswordLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
};

function calculateAge(dateOfBirth: string, now = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dob = new Date(year, month - 1, day);
  if (
    dob.getFullYear() !== year ||
    dob.getMonth() !== month - 1 ||
    dob.getDate() !== day ||
    dob > now
  ) {
    return null;
  }
  let age = now.getFullYear() - year;
  if (
    now.getMonth() < month - 1 ||
    (now.getMonth() === month - 1 && now.getDate() < day)
  ) {
    age -= 1;
  }
  return age;
}

export default function LoginScreen() {
  const { login, register, isAuthenticated } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [recoveryStage, setRecoveryStage] = useState<RecoveryStage>('email');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [passwordPolicy, setPasswordPolicy] = useState(DEFAULT_PASSWORD_POLICY);

  const phoneRef = useRef<TextInput>(null);
  const dateOfBirthRef = useRef<TextInput>(null);
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

  const passwordValidationMessage = (value: string): string | null => {
    if (value.length < passwordPolicy.minPasswordLength) {
      return `Password must be at least ${passwordPolicy.minPasswordLength} characters.`;
    }
    if (passwordPolicy.requireUppercase && !/[A-Z]/.test(value)) return 'Password must include an uppercase letter.';
    if (passwordPolicy.requireLowercase && !/[a-z]/.test(value)) return 'Password must include a lowercase letter.';
    if (passwordPolicy.requireNumber && !/[0-9]/.test(value)) return 'Password must include a number.';
    if (passwordPolicy.requireSymbol && !/[^A-Za-z0-9]/.test(value)) return 'Password must include a symbol.';
    return null;
  };

  const validate = (): string | null => {
    if (mode === 'recover') {
      if (recoveryStage === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
        return null;
      }
      if (recoveryStage === 'otp') {
        if (!/^\d{6}$/.test(otp)) return 'Enter the six-digit verification code.';
        return null;
      }
      if (!resetToken) return 'Your reset session has expired. Please request a new code.';
      const passwordError = passwordValidationMessage(password);
      if (passwordError) return passwordError;
      if (password !== confirmPassword) return 'The passwords do not match.';
      return null;
    }
    if (mode === 'register' && name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (mode === 'register') {
      const calculatedAge = calculateAge(dateOfBirth);
      if (calculatedAge === null) return 'Enter your date of birth as YYYY-MM-DD.';
      if (calculatedAge < 18) return 'You must be 18 or older to register for MobiCare.';
    }
    if (phone.trim().length < 5) return 'Enter a valid phone number.';
    const passwordError = passwordValidationMessage(password);
    if (passwordError) return passwordError;
    return null;
  };

  const requestResetCode = async () => {
    const result = await requestPatientEmailPasswordReset({ email: email.trim() });
    setRecoveryStage('otp');
    setOtp('');
    setResetToken(null);
    setRetryAfter(Math.ceil(result.retryAfterSeconds));
    setPasswordPolicy(result.passwordPolicy);
    Alert.alert(
      'Check your email',
      'If this email belongs to an active patient account, we sent a six-digit verification code.',
    );
  };

  const recoveryErrorMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : '';
    const normalized = message.toLowerCase();
    if (
      normalized.includes('invalid') ||
      normalized.includes('expired') ||
      normalized.includes('used') ||
      normalized.includes('otp') ||
      normalized.includes('code')
    ) {
      return 'That verification code is invalid, expired, or has already been used. Request a new code and try again.';
    }
    return message || 'Something went wrong. Please try again.';
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { Alert.alert('Invalid Input', err); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(phone.trim(), password);
      } else if (mode === 'recover') {
        if (recoveryStage === 'email') {
          await requestResetCode();
        } else if (recoveryStage === 'otp') {
          const result = await verifyPatientEmailPasswordResetOtp({ email: email.trim(), otp });
          setResetToken(result.resetToken);
          setRecoveryStage('password');
          setOtp('');
        } else if (resetToken) {
          await resetPatientEmailPassword({ resetToken, newPassword: password });
          setMode('login');
          setEmail('');
          setRecoveryStage('email');
          setOtp('');
          setResetToken(null);
          setPassword('');
          setConfirmPassword('');
          Alert.alert('Password reset', 'Sign in with your new password.');
        }
      } else {
        await register(name.trim(), phone.trim(), password, dateOfBirth);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      const friendly = mode === 'recover'
        ? recoveryErrorMessage(e)
        : mode === 'login' && (msg.includes('401') || msg.includes('Invalid'))
        ? 'Incorrect phone number or password.'
        : mode === 'register' && (msg.includes('409') || msg.includes('already'))
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
    setDateOfBirth('');
    setPhone('');
    setPassword('');
    setEmail('');
    setRecoveryStage('email');
    setOtp('');
    setResetToken(null);
    setConfirmPassword('');
    setRetryAfter(0);
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
          <MobiCareLogo inverse />
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
                onSubmitEditing={() => dateOfBirthRef.current?.focus()}
                blurOnSubmit={false}
              />
            </View>
          )}
          {mode === 'register' && (
            <View style={s.field}>
              <Text style={s.label}>Date of Birth</Text>
              <TextInput
                ref={dateOfBirthRef}
                style={s.input}
                value={dateOfBirth}
                onChangeText={(value) =>
                  setDateOfBirth(value.replace(/[^\d-]/g, '').slice(0, 10))
                }
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedForeground}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                autoComplete="birthdate-full"
                textContentType="none"
                maxLength={10}
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
                blurOnSubmit={false}
              />
              <Text style={s.fieldHint}>Your age is calculated automatically. Date of birth and age cannot be changed later.</Text>
            </View>
          )}
          {mode !== 'recover' && <View style={s.field}>
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
          </View>}
          {mode === 'recover' && recoveryStage === 'email' && (
            <View style={s.field}>
              <Text style={s.label}>Email address</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                importantForAutofill="yes"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>
          )}
          {mode === 'recover' && recoveryStage === 'otp' && (
            <View style={s.field}>
              <Text style={s.label}>Six-digit email verification code</Text>
              <TextInput
                style={s.input}
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                importantForAutofill="yes"
                maxLength={6}
                returnKeyType="next"
                onSubmitEditing={handleSubmit}
              />
            </View>
          )}
          {(mode !== 'recover' || recoveryStage === 'password') && <View style={s.field}>
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
            {mode === 'recover' && (
              <View>
                <Text style={s.fieldHint}>
                  {password.length >= passwordPolicy.minPasswordLength ? '✓' : '○'} At least {passwordPolicy.minPasswordLength} characters
                </Text>
                {passwordPolicy.requireUppercase && <Text style={s.fieldHint}>
                  {/[A-Z]/.test(password) ? '✓' : '○'} Uppercase letter
                </Text>}
                {passwordPolicy.requireLowercase && <Text style={s.fieldHint}>
                  {/[a-z]/.test(password) ? '✓' : '○'} Lowercase letter
                </Text>}
                {passwordPolicy.requireNumber && <Text style={s.fieldHint}>
                  {/[0-9]/.test(password) ? '✓' : '○'} Number
                </Text>}
                {passwordPolicy.requireSymbol && <Text style={s.fieldHint}>
                  {/[^A-Za-z0-9]/.test(password) ? '✓' : '○'} Symbol
                </Text>}
              </View>
            )}
          </View>}
          {mode === 'recover' && recoveryStage === 'password' && (
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
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : recoveryStage === 'email' ? 'Send Email Code' : recoveryStage === 'otp' ? 'Verify Code' : 'Reset Password'}
            </Text>
          </TouchableOpacity>
          {mode === 'login' && (
            <Pressable style={s.linkButton} onPress={() => switchMode('recover')}>
                <Text style={s.linkText}>Reset password via email</Text>
            </Pressable>
          )}
          {mode === 'recover' && (
            <View style={s.recoveryLinks}>
              <Pressable onPress={() => switchMode('login')}>
                <Text style={s.linkText}>Back to sign in</Text>
              </Pressable>
              {recoveryStage === 'otp' && (
                <Pressable
                  disabled={loading || retryAfter > 0}
                  onPress={async () => {
                    setLoading(true);
                    try {
                      await requestResetCode();
                    } catch (error) {
                      Alert.alert(
                        'Could not resend code',
                        recoveryErrorMessage(error),
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
    fieldHint: { fontSize: 11, lineHeight: 16, color: colors.mutedForeground, marginTop: 6 },
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
