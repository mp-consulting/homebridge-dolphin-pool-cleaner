/**
 * MyDolphin REST client
 *
 * Thin wrapper around the native fetch API for the Maytronics backend.
 */
import { API_TIMEOUT_MS, MAYTRONICS_API } from '../config/constants.js';
import { ApiError, ErrorCode } from '../utils/errors.js';

/**
 * Envelope returned by every MyDolphin endpoint
 */
export interface MyDolphinResponse<T = Record<string, unknown>> {
  Status?: string;
  Alert?: string;
  Data?: T;
}

export interface RequestOptions {
  bearerToken?: string;
  params?: Record<string, string | undefined>;
}

/**
 * Minimal HTTP client for the MyDolphin backend
 */
export class MyDolphinHttpClient {
  constructor(
    private readonly baseUrl: string = MAYTRONICS_API.BASE_URL,
    private readonly timeoutMs: number = API_TIMEOUT_MS,
  ) {}

  get<T>(path: string, options: RequestOptions = {}): Promise<MyDolphinResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  /**
   * POST a form-encoded body
   */
  post<T>(path: string, form: Record<string, string> | undefined, options: RequestOptions = {}): Promise<MyDolphinResponse<T>> {
    const body = form ? new URLSearchParams(form).toString() : '';
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body: string | undefined,
    { bearerToken, params }: RequestOptions,
  ): Promise<MyDolphinResponse<T>> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      AppKey: MAYTRONICS_API.APP_KEY,
      Accept: '*/*',
      'User-Agent': MAYTRONICS_API.USER_AGENT,
    };
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new ApiError(ErrorCode.API_REQUEST_FAILED, `${method} ${url.pathname} failed`, { cause: error });
    }

    if (!response.ok) {
      throw new ApiError(
        ErrorCode.API_REQUEST_FAILED,
        `${method} ${url.pathname} failed: HTTP ${response.status}`,
        { context: { status: response.status } },
      );
    }

    try {
      return (await response.json()) as MyDolphinResponse<T>;
    } catch (error) {
      throw new ApiError(ErrorCode.API_INVALID_RESPONSE, `${method} ${url.pathname} returned invalid JSON`, { cause: error });
    }
  }
}
