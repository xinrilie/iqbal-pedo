export function accessTokenClaims(user) {
  return {
    payload: {
      company_id: user.company_id,
      outlet_id: user.outlet_id,
      token_version: user.auth_token_version
    },
    options: { sub: user.id }
  };
}
