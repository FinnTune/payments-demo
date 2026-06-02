/**
 * Typed client for the payments API.
 *
 * Returns Result<T> (a discriminated union) instead of throwing on failure.
 * Callers must handle both branches at compile time; TypeScript won't let
 * them read .value on a failed result or .error on a successful one.
 */

// ----- Types matching the backend DTOs -----

export type Currency = "EUR" | "USD" | "GBP";

export type PaymentStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "DECLINED"
  | "REFUNDED"
  | "FAILED";

export interface CreatePaymentRequest {
  amount: string;          // string, not number — money is exact, no floats
  currency: Currency;
  customerId: string;
  paymentMethodToken: string;
}

export interface PaymentResponse {
  id: string;
  customerId: string;
  amount: string;
  currency: Currency;
  status: PaymentStatus;
  authCode: string | null;
  declineReason: string | null;
  createdAt: string;       // ISO-8601 string from Instant
  updatedAt: string;
}

export interface ApiError {
  code: string;
  message: string;
  timestamp: string;
}

// ----- Result<T>: the discriminated-union return type -----

export type Result<T> =
  | { ok: true;  value: T }
  | { ok: false; error: ApiError };

// ----- The API functions -----

const BASE_URL = "/api/v1/payments";

export async function createPayment(
  req: CreatePaymentRequest,
  jwt: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<Result<PaymentResponse>> {
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(req),
    });

    return await readResponse<PaymentResponse>(res);
  } catch (e) {
    return networkError(e);
  }
}

export async function getPayment(
  id: string,
  jwt: string,
): Promise<Result<PaymentResponse>> {
  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}`, {
      headers: { "Authorization": `Bearer ${jwt}` },
    });

    return await readResponse<PaymentResponse>(res);
  } catch (e) {
    return networkError(e);
  }
}

// ----- Internal helpers -----

async function readResponse<T>(res: Response): Promise<Result<T>> {
  const body = (await res.json().catch(() => null)) as T | ApiError | null;

  if (!res.ok) {
    const error: ApiError =
      body && typeof body === "object" && "code" in body
        ? (body as ApiError)
        : {
            code: `HTTP_${res.status}`,
            message: res.statusText || "Unknown error",
            timestamp: new Date().toISOString(),
          };
    return { ok: false, error };
  }

  if (!body) {
    return {
      ok: false,
      error: {
        code: "EMPTY_RESPONSE",
        message: "Server returned an empty body on success",
        timestamp: new Date().toISOString(),
      },
    };
  }

  return { ok: true, value: body as T };
}

function networkError(e: unknown): Result<never> {
  return {
    ok: false,
    error: {
      code: "NETWORK_ERROR",
      message: e instanceof Error ? e.message : "Unknown network error",
      timestamp: new Date().toISOString(),
    },
  };
}