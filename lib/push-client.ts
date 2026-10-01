type PushConfiguration = {
  configured: boolean;
  publicKey: string | null;
  error?: string;
};

function applicationServerKey(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function parse<T extends { error?: string }>(response: Response) {
  const body = await response.json() as T;
  if (!response.ok) throw new Error(body.error ?? 'The request failed.');
  return body;
}

export async function getPushConfiguration() {
  const response = await fetch('/api/push', { cache: 'no-store' });
  return parse<PushConfiguration>(response);
}

export async function enablePushNotifications(publicKey: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push notifications are not supported on this device.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  await parse<{ subscribed: boolean; error?: string }>(await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  }));
  return subscription;
}

export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await parse<{ subscribed: boolean; error?: string }>(await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }));
  await subscription.unsubscribe();
}
