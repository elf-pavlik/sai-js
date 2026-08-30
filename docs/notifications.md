# Notifications

Solid Notifications Protocol references — used by the `invitation-accept` view
(`docs/temporal.c4`, step "notify Add activity (subscription webhook)"):

- [Solid Notifications Protocol](https://solidproject.org/TR/notifications-protocol)
- [Webhook Channel Type 2023](https://solid.github.io/notifications/webhook-channel-2023)
- [Streaming HTTP Channel Type 2023](https://solid.github.io/notifications/streaming-http-channel-2023)

## Add notification

Example of an `Add` notification as JSON-LD, from the [protocol
spec](https://solidproject.org/TR/notifications-protocol) (data model §,
"Example: An add activity"):

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://www.w3.org/ns/solid/notifications-context/v1"
  ],
  "id": "urn:uuid:a4da6738-6be0-11ed-90bd-1be4ba6b6b33",
  "type": "Add",
  "object": "https://example.org/guinan/photos/image",
  "target": "https://example.org/guinan/photos/",
  "published": "2022-11-24T11:55:31.483Z"
}
```

The notification is an Activity Streams 2.0 object: `id` (notification
identity), `type` (the activity type — `Add` here), `object` (the topic
resource the notification is about), optional `target` (the container the
activity is directed to), `published` (timestamp), plus an optional `state`
(hidden unless it changes).