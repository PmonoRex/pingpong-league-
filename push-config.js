// Web Push public key (VAPID), from the key pair whose private half is the Edge Function secret VAPID_PRIVATE_KEY.
// Empty = no push server yet: pwa.js keeps the in-app notifications only. See docs/push-notifications.md.
// This key is public by design; the private key must never be put in this repository.
window.PUSH_VAPID_PUBLIC_KEY = "";
