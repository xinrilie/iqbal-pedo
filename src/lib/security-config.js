const JWT_TTL_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

export function validateRuntimeSecurity(config, { testOnlyPaymentEnabled = false } = {}) {
  const secret = config.JWT_SECRET;
  if (/replace-with|change-me|your-secret/i.test(secret) || new Set(secret).size < 12) {
    throw new Error('JWT_SECRET masih memakai nilai contoh atau terlalu mudah ditebak. Buat secret acak minimal 32 karakter.');
  }

  const ttl = /^(\d+)([smhd])$/.exec(config.JWT_TTL);
  const ttlSeconds = ttl ? Number(ttl[1]) * JWT_TTL_UNITS[ttl[2]] : 0;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86400) {
    throw new Error('JWT_TTL harus berupa durasi 5 menit sampai 24 jam, misalnya 15m.');
  }

  const origins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  if (!origins.length || origins.some((origin) => !origin || origin === '*')) {
    throw new Error('CORS_ORIGIN harus berisi daftar origin yang spesifik, bukan wildcard.');
  }
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); }
    catch { throw new Error('Setiap CORS_ORIGIN harus berupa origin URL yang valid tanpa path.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('Setiap CORS_ORIGIN harus berisi origin URL tanpa path atau kredensial.');
    }
    if (config.NODE_ENV === 'production' && (parsed.protocol !== 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname))) {
      throw new Error('Produksi hanya boleh memakai CORS origin HTTPS non-lokal.');
    }
  }

  if (config.NODE_ENV === 'production' && testOnlyPaymentEnabled) {
    throw new Error('GCIMS_ALLOW_TEST_ONLY_PAYMENT tidak boleh aktif di produksi.');
  }
}
