// Sends a signed test request to the local Okendo webhook receiver.
//
// Usage:
//   OKENDO_WEBHOOK_SECRET=whsec_... node test-okendo-webhook.mjs
//   node test-okendo-webhook.mjs                # no secret -> tests the "signature skipped" path
//
// Optional:
//   URL=http://localhost:3000/webhooks/okendo node test-okendo-webhook.mjs
// OKENDO_WEBHOOK_SECRET=whsec_7KJj/5zdExClPieZOt/uEFGk1VgOfDfc URL=https://carve-designs-hydrogen-ccc0d9c88d2423b95ba3.o2.myshopify.dev/webhooks/okendo node /Users/anton/codes2/CARVE_CE_HYDROGEN/.cursor/test-okendo-webhook.mjs

import { createHmac, randomUUID } from 'node:crypto';

const URL_TARGET = process.env.URL ?? 'http://localhost:3000/webhooks/okendo';
const SECRET = process.env.OKENDO_WEBHOOK_SECRET; // e.g. whsec_MfKQ9r8...

const payload = {
  resourceType: 'survey_response',
  resource: {
    subscriberId: 'sub_test_123',
    surveyResponseId: 'resp_test_456',
    surveyId: 'survey_789',
    surveyName: 'Post-purchase survey',
    dateCreated: new Date(0).toISOString(), // fixed timestamp for a repeatable test payload
    channel: 'email',
    customer: { customerId: 'cust_1', email: 'test@example.com' },
    order: { remoteOrderId: 'order_1001' },
    answeredQuestions: [
      { id: 'q1', type: 'single_choice', text: 'How did you hear about us?', answer: 'Instagram' },
    ],
  },
  sequenceNumber: '1',
  topic: 'survey.response.created',
  version: '1',
};

const rawBody = JSON.stringify(payload);
const webhookId = `msg_${randomUUID()}`;
const webhookTimestamp = Math.floor(Date.now() / 1000).toString();

const headers = {
  'Content-Type': 'application/json',
};

if (SECRET) {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const signature = createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  headers['webhook-id'] = webhookId;
  headers['webhook-timestamp'] = webhookTimestamp;
  headers['webhook-signature'] = `v1,${signature}`;
} else {
  console.log('No OKENDO_WEBHOOK_SECRET set — sending unsigned (tests the skip-validation path).');
}

const res = await fetch(URL_TARGET, { method: 'POST', headers, body: rawBody });
console.log(`--> ${res.status} ${res.statusText}`);
console.log(await res.text());
