export function accessTokenClaims(user, csrfToken) {
  return {
    payload: {
      company_id: user.company_id,
      outlet_id: user.outlet_id,
      token_version: user.auth_token_version,
      csrf_token: csrfToken
    },
    options: { sub: user.id }
  };
}
