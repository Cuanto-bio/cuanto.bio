export async function signOut() {
  const { clearIdbUser } = await import('$lib/offline/db');
  await clearIdbUser();
  window.location.href = '/auth/signout';
}
