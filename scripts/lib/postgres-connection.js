export function parsePostgresConnection(connectionString, label = 'DATABASE_URL') {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${label} tidak valid.`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error(`${label} harus berupa URL PostgreSQL lengkap dengan nama database.`);
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!databaseName || !username) throw new Error(`${label} harus memuat nama database dan username.`);

  const args = ['--host', url.hostname, '--port', url.port || '5432', '--username', username, '--dbname', databaseName];
  const env = {};
  env.PGPASSWORD = password;
  const sslMode = url.searchParams.get('sslmode');
  const sslRootCert = url.searchParams.get('sslrootcert');
  if (sslMode) env.PGSSLMODE = sslMode;
  if (sslRootCert) env.PGSSLROOTCERT = sslRootCert;

  return { args, databaseName, env, host: url.hostname, port: url.port || '5432' };
}
