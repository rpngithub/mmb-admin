import { createContext, useContext } from 'react';

/**
 * Step-up auth: some admin calls need the admin's password re-typed, sent as
 * the `X-Admin-Password` header on THAT ONE request.
 *
 * The password must never be stored — not in React state, not in Redux, not in
 * localStorage. RTK Query keeps every mutation's `originalArgs` in the store,
 * so the password can't travel as a mutation argument either. Instead:
 *
 *   1. the modal reads the typed value straight off an uncontrolled input,
 *   2. `stashSecret()` parks it in a module-level Map under a random one-shot
 *      token, and the mutation is called with that opaque token,
 *   3. the endpoint's `query()` calls `takeSecret(token)`, which hands the value
 *      over AND deletes it, so it lives exactly as long as the request build.
 *
 * The same one-shot channel carries the provider API key value on the
 * "add credential" call, which is just as sensitive.
 */
const pending = new Map();

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Park a secret for exactly one request. Returns the opaque token. */
export function stashSecret(value) {
  const token = `oneshot:${randomToken()}`;
  pending.set(token, value);
  return token;
}

/** Hand the secret over and forget it. Unknown / reused tokens give undefined. */
export function takeSecret(token) {
  if (!token) return undefined;
  const value = pending.get(token);
  pending.delete(token);
  return value;
}

/** Drop a stashed secret that was never used (request failed before building). */
export function discardSecret(token) {
  if (token) pending.delete(token);
}

/**
 * Headers for a request that may carry a step-up token. Spread into the
 * request: `{ url, method, body, headers: stepUpHeaders(stepUp) }`.
 */
export function stepUpHeaders(stepUpToken) {
  const password = takeSecret(stepUpToken);
  return password ? { 'X-Admin-Password': password } : undefined;
}

// ---- error codes -------------------------------------------------------------
// These are 403 / 429, NOT 401 — baseQuery only refreshes / logs out on 401,
// so the admin is never signed out by a wrong password.
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';
export const REAUTH_FAILED = 'REAUTH_FAILED';
export const REAUTH_LOCKED = 'REAUTH_LOCKED';

export const isReauthError = (err) =>
  [REAUTH_REQUIRED, REAUTH_FAILED, REAUTH_LOCKED].includes(err?.code);

/** Thrown (rejected) when the admin closes the password modal. */
export const STEP_UP_CANCELLED = { code: 'STEP_UP_CANCELLED', cancelled: true };
export const isStepUpCancel = (err) => err?.code === 'STEP_UP_CANCELLED';

export const StepUpContext = createContext(null);

/**
 * `const stepUp = useStepUp();`
 *
 * `await stepUp.run((stepUp) => trigger({ ..., stepUp }).unwrap(), options)`
 *
 *   options.upfront (default true) — ask for the password before the first try.
 *     With `false` the call goes out without it, and the modal only opens if
 *     the server answers 403 REAUTH_REQUIRED (for writes that need step-up
 *     only for some fields).
 *   options.title / options.description — modal copy.
 *
 * Resolves with `fn`'s result. Rejects with STEP_UP_CANCELLED if the modal is
 * closed, or with the API error for anything that isn't a re-auth problem
 * (the modal closes and the caller shows it).
 */
export function useStepUp() {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used inside <StepUpProvider>');
  return ctx;
}
