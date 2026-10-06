'use client';

import { useEffect, useState } from 'react';
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushConfiguration,
} from '../../lib/push-client';
import styles from './push-notification-control.module.css';

type PushState = 'checking' | 'unsupported' | 'unavailable' | 'blocked' | 'disabled' | 'enabled' | 'working' | 'error';

export default function PushNotificationControl() {
  const [state, setState] = useState<PushState>('checking');
  const [publicKey, setPublicKey] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function prepare() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('unsupported');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        const configuration = await getPushConfiguration();
        if (!configuration.configured || !configuration.publicKey) {
          setState('unavailable');
          return;
        }
        setPublicKey(configuration.publicKey);
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) setState('enabled');
        else if (Notification.permission === 'denied') setState('blocked');
        else setState('disabled');
      } catch {
        setState('error');
      }
    }
    void prepare();
  }, []);

  async function enable() {
    if (!publicKey) return;
    try {
      setState('working');
      setMessage('');
      await enablePushNotifications(publicKey);
      setState('enabled');
      setMessage('Browser alerts are enabled on this device.');
    } catch (error) {
      setState('Notification' in window && Notification.permission === 'denied' ? 'blocked' : 'error');
      setMessage(error instanceof Error ? error.message : 'Browser alerts could not be enabled.');
    }
  }

  async function disable() {
    try {
      setState('working');
      setMessage('');
      await disablePushNotifications();
      setState('disabled');
      setMessage('Browser alerts are disabled on this device.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Browser alerts could not be disabled.');
    }
  }

  const copy = state === 'enabled' ? 'This browser receives every work notification sent to administrators.'
    : state === 'blocked' ? 'Notifications are blocked in this browser’s site settings.'
      : state === 'unsupported' ? 'This browser does not support Web Push.'
        : state === 'unavailable' ? 'Web Push is not configured on the server.'
          : 'Receive work alerts even when the dashboard is closed.';

  return (
    <div className={styles.control}>
      <span aria-hidden="true">↗</span>
      <div><strong>{state === 'enabled' ? 'Browser alerts enabled' : 'Background notifications'}</strong><small>{copy}</small>{message ? <em role="status">{message}</em> : null}</div>
      {state === 'enabled' ? <button type="button" onClick={() => void disable()}>Disable</button>
        : state === 'disabled' || state === 'error' ? <button type="button" onClick={() => void enable()}>Enable</button>
          : state === 'checking' || state === 'working' ? <button type="button" disabled>Checking…</button>
            : null}
    </div>
  );
}
