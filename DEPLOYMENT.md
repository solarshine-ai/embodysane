# Vercel deployment notes

The static application can deploy on Vercel. The new `api/` functions support conversion measurement and durable inner-circle lead capture.

## Required environment variable

Set `LEAD_CAPTURE_WEBHOOK_URL` to an HTTPS endpoint owned by the selected email provider or automation service. The endpoint receives:

```json
{ "email": "subscriber@example.com", "source": "embodysane.com" }
```

Do not log the request body at the destination. The function validates consent and email format, forwards only the email and source, and tracks the aggregate `lead_capture_submitted` event.

## Conversion events

The app sends aggregate Web Analytics custom events through `/api/events`:

- `assessment_started`
- `analyzer_started`
- `checkout_started`
- `lead_capture_submitted`

Do not attach diary entries, conversation text, emails, or other personal data to analytics events.

## Remaining migration work

The account, identity, database, payment verification, and AI routes under `netlify/` remain Netlify-specific. They need a separate migration to Vercel-compatible identity and database providers before the full application backend can run on Vercel.
