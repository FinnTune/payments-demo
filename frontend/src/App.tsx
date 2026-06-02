import { useState } from "react";
import {
  createPayment,
  type CreatePaymentRequest,
  type PaymentResponse,
  type ApiError,
  type Currency,
} from "./api/payments";
import "./App.css";

type FormState = {
  amount: string;
  currency: Currency;
  customerId: string;
  paymentMethodToken: string;
};

type UiState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success"; payment: PaymentResponse }
  | { phase: "error"; error: ApiError };

const DEFAULT_FORM: FormState = {
  amount: "12.50",
  currency: "EUR",
  customerId: "cust_demo",
  paymentMethodToken: "tok_visa",
};

export default function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [ui, setUi] = useState<UiState>({ phase: "idle" });

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUi({ phase: "submitting" });

    const req: CreatePaymentRequest = {
      amount: form.amount,
      currency: form.currency,
      customerId: form.customerId,
      paymentMethodToken: form.paymentMethodToken,
    };

    // No real JWT yet (no OAuth2 issuer wired up). The backend's
    // SecurityConfig.java currently has /api/v1/payments/** permitAll
    // during local dev, so the empty token is accepted.
    const result = await createPayment(req, "");

    if (result.ok) {
      setUi({ phase: "success", payment: result.value });
    } else {
      setUi({ phase: "error", error: result.error });
    }
  };

  const resetToIdle = () => setUi({ phase: "idle" });

  return (
    <div className="app">
      <h1>Payments Demo</h1>

      <form onSubmit={handleSubmit} className="payment-form">
        <label>
          Amount
          <input
            type="text"
            value={form.amount}
            onChange={(e) => updateField("amount", e.target.value)}
            disabled={ui.phase === "submitting"}
            required
          />
        </label>

        <label>
          Currency
          <select
            value={form.currency}
            onChange={(e) => updateField("currency", e.target.value as Currency)}
            disabled={ui.phase === "submitting"}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </label>

        <label>
          Customer ID
          <input
            type="text"
            value={form.customerId}
            onChange={(e) => updateField("customerId", e.target.value)}
            disabled={ui.phase === "submitting"}
            required
          />
        </label>

        <label>
          Payment Method Token
          <input
            type="text"
            value={form.paymentMethodToken}
            onChange={(e) => updateField("paymentMethodToken", e.target.value)}
            disabled={ui.phase === "submitting"}
            required
          />
        </label>

        <button type="submit" disabled={ui.phase === "submitting"}>
          {ui.phase === "submitting" ? "Submitting…" : "Submit Payment"}
        </button>
      </form>

      {ui.phase === "success" && (
        <ResultPanel kind="success" onReset={resetToIdle}>
          <h2>Payment {ui.payment.status}</h2>
          <dl>
            <dt>ID</dt>            <dd>{ui.payment.id}</dd>
            <dt>Amount</dt>         <dd>{ui.payment.amount} {ui.payment.currency}</dd>
            <dt>Status</dt>         <dd>{ui.payment.status}</dd>
            {ui.payment.authCode && (
              <>
                <dt>Auth Code</dt>  <dd>{ui.payment.authCode}</dd>
              </>
            )}
            {ui.payment.declineReason && (
              <>
                <dt>Decline Reason</dt> <dd>{ui.payment.declineReason}</dd>
              </>
            )}
            <dt>Created</dt>        <dd>{ui.payment.createdAt}</dd>
          </dl>
        </ResultPanel>
      )}

      {ui.phase === "error" && (
        <ResultPanel kind="error" onReset={resetToIdle}>
          <h2>Error</h2>
          <dl>
            <dt>Code</dt>      <dd>{ui.error.code}</dd>
            <dt>Message</dt>   <dd>{ui.error.message}</dd>
            <dt>Timestamp</dt> <dd>{ui.error.timestamp}</dd>
          </dl>
        </ResultPanel>
      )}
    </div>
  );
}

function ResultPanel(props: {
  kind: "success" | "error";
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`result result-${props.kind}`}>
      {props.children}
      <button onClick={props.onReset}>New payment</button>
    </div>
  );
}