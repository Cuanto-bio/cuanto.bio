export async function signOut() {
  const { clearIdb } = await import('$lib/offline/db');
  await clearIdb();
  window.location.href = '/auth/signout';
}
