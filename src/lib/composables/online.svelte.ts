export function useOnline() {
  let isOnline = $state(true);
  $effect(() => {
    isOnline = navigator.onLine;
    const on = () => {
      isOnline = true;
    };
    const off = () => {
      isOnline = false;
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });
  return {
    get value() {
      return isOnline;
    },
  };
}
