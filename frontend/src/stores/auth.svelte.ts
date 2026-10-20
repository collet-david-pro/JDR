import { ApiError, type ApiClient } from '../lib/api';
import type { AuthStatus } from '../lib/guard';
import type {
  AuthResult,
  LoginInput,
  MeResponse,
  Prefs,
  RegisterInput,
  RegistrationMode,
  User,
} from '../lib/types';
import type { RemotePrefSync } from './prefs.svelte';

/** Theme side of the preferences (implemented by stores/prefs.svelte.ts). */
export interface ThemeSink {
  applyRemote(values: Prefs): string[];
  setRemoteSync(sync: RemotePrefSync | null): void;
  valueOf(key: string): string | null;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError({ code: 'http_error', message: String(error), status: 0 });
}

/**
 * Authentication state (projet.md 13.2): current user, CSRF token (handed to the API
 * client), registration mode, SMTP availability and account preferences.
 */
export class AuthStore {
  status = $state<AuthStatus>('loading');
  user = $state.raw<User | null>(null);
  registrationMode = $state<RegistrationMode>('closed');
  smtpEnabled = $state(false);
  error = $state.raw<ApiError | null>(null);
  readonly isAdmin: boolean = $derived(this.user?.role === 'admin');

  constructor(
    private readonly api: ApiClient,
    private readonly theme: ThemeSink,
  ) {}

  /** GET /auth/me: session, CSRF token, preferences. Never throws. */
  async bootstrap(): Promise<void> {
    try {
      const { data } = await this.api.get<MeResponse>('/auth/me');
      this.applyMe(data);
      this.error = null;
      this.status = 'ready';
    } catch (error) {
      this.error = asApiError(error);
      if (this.status !== 'ready') this.status = 'error';
    }
  }

  /** POST /auth/login. Throws ApiError (invalid_credentials, rate_limited, ...). */
  async login(input: LoginInput): Promise<User> {
    const { data } = await this.api.post<AuthResult>('/auth/login', input, {
      notifyUnauthorized: false,
    });
    return this.signedIn(data);
  }

  /** POST /auth/register (signed in directly). Throws ApiError. */
  async register(input: RegisterInput): Promise<User> {
    const { data } = await this.api.post<AuthResult>('/auth/register', input);
    return this.signedIn(data);
  }

  /** POST /auth/logout, then a fresh anonymous session (new CSRF token). */
  async logout(): Promise<void> {
    try {
      await this.api.post('/auth/logout', undefined, { notifyUnauthorized: false });
    } finally {
      this.signedOut();
      await this.bootstrap();
    }
  }

  /** After PATCH /me or an equivalent update. */
  setUser(user: User): void {
    this.user = user;
  }

  /** The account no longer exists (DELETE /me): back to an anonymous session. */
  async forget(): Promise<void> {
    this.signedOut();
    await this.bootstrap();
  }

  /** A request answered 401: the session has expired or was revoked. */
  handleUnauthorized(): void {
    if (this.user === null) return;
    this.signedOut();
    void this.bootstrap();
  }

  /** PUT /me/prefs/{key} (signed in only). Failures are not fatal: the device keeps it. */
  async savePref(key: string, value: unknown): Promise<void> {
    if (this.user === null) return;
    try {
      await this.api.put(`/me/prefs/${encodeURIComponent(key)}`, { value });
    } catch (error) {
      console.warn('[prefs] not saved', key, error);
    }
  }

  private async signedIn(result: AuthResult): Promise<User> {
    this.api.setCsrfToken(result.csrf);
    this.user = result.user;
    this.status = 'ready';
    // Account preferences (theme) come with GET /auth/me.
    await this.bootstrap();
    return result.user;
  }

  private signedOut(): void {
    this.user = null;
    this.theme.setRemoteSync(null);
  }

  private applyMe(me: MeResponse): void {
    this.api.setCsrfToken(me.csrf);
    this.registrationMode = me.registration_mode;
    this.smtpEnabled = me.smtp_enabled === true;
    this.user = me.user;
    if (me.user === null) {
      this.theme.setRemoteSync(null);
      return;
    }
    const missing = this.theme.applyRemote(me.prefs ?? {});
    this.theme.setRemoteSync((key, value) => void this.savePref(key, value));
    // First sign-in on this account: keep the device theme and store it on the account.
    for (const key of missing) {
      const value = this.theme.valueOf(key);
      if (value !== null) void this.savePref(key, value);
    }
  }
}
