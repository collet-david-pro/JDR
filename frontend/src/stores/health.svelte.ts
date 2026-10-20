import { ApiError, type ApiClient } from '../lib/api';
import { parseHealth, type HealthData } from '../lib/health';

export type HealthStatus = 'loading' | 'ok' | 'error';

/** API health check state (provisional home page). */
export class HealthCheck {
  status = $state<HealthStatus>('loading');
  data = $state.raw<HealthData | null>(null);
  error = $state.raw<ApiError | null>(null);
  serverVersion = $state<string | null>(null);

  constructor(private readonly api: ApiClient) {}

  async run(): Promise<void> {
    this.status = 'loading';
    this.error = null;
    try {
      const response = await this.api.get<unknown>('/health');
      const data = parseHealth(response.data);
      if (data === null) {
        throw new ApiError({
          code: 'invalid_response',
          message: 'Invalid health payload',
          status: response.status,
          requestId: response.requestId,
        });
      }
      this.data = data;
      this.status = 'ok';
    } catch (error) {
      this.data = null;
      this.error =
        error instanceof ApiError
          ? error
          : new ApiError({ code: 'http_error', message: String(error), status: 0 });
      this.status = 'error';
    }
  }
}
