import webpush, { type SendResult } from 'web-push'

webpush.setVapidDetails(
  process.env.PUSH_NOTIFICATION_EMAIL!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)
export async function forwardToPush(subscription: any, payload: any): Promise<SendResult> {
  return webpush.sendNotification(subscription, JSON.stringify(payload))
}
