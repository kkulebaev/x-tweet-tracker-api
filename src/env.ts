export function mustEnv(key: string): string {
  const v = (process.env[key] ?? '').trim();
  if (!v) throw new Error(`${key} is required`);
  return v;
}
