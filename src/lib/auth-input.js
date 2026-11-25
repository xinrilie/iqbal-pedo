/**
 * Convert either the prototype username payload or the legacy scoped payload
 * into the auth service contract at the HTTP boundary. The scoped email form
 * remains supported for existing integration scripts and API clients.
 */
export function isBcryptPasswordLengthValid(value) {
  return Buffer.byteLength(value, 'utf8') <= 72;
}

export function toLoginCredentials(payload) {
  if (payload.username !== undefined) {
    return { username: payload.username, password: payload.password };
  }
  return {
    email: payload.email,
    password: payload.password,
    companyId: payload.company_id,
    outletId: payload.outlet_id
  };
}
