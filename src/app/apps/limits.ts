// The longest reason a request can carry. One plain module, so the action
// (the real guard), the form's maxLength and the page's error text all read
// the same number: a "use server" module can only export async functions,
// and a value exported from a "use client" one reaches a server component
// as a client reference, not a number.
export const MAX_REASON_LENGTH = 500;
