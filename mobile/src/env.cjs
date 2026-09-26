// CommonJS keeps this helper usable by Expo's Node config loader and Metro.
function backendUrl(value) {
  const message = 'Set EXPO_PUBLIC_BACKEND_URL in mobile/.env to an HTTP(S) backend URL (no credentials, query, or fragment).';
  if (!value?.trim()) throw new Error(message);
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.search || url.hash) throw new Error(message);
  return url.toString().replace(/\/$/, '');
}
exports.backendUrl = backendUrl;
