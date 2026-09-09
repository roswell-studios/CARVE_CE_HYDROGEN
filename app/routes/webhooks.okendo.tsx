import type {Route} from './+types/webhooks.okendo';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, webhook-id, webhook-signature, webhook-timestamp',
};

export async function loader({request}: Route.LoaderArgs) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: corsHeaders});
  }
  return new Response('Method not allowed', {
    status: 405,
    headers: corsHeaders,
  });
}

export async function action({request, context}: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error('[Okendo Webhook] Failed to parse JSON body');
    return new Response('Invalid JSON', {status: 400, headers: corsHeaders});
  }

  const secret = context.env.OKENDO_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      '[Okendo Webhook] OKENDO_WEBHOOK_SECRET is not set — accepting request for debugging but skipping signature validation',
    );
  } else {
    const webhookId = request.headers.get('webhook-id');
    const webhookTimestamp = request.headers.get('webhook-timestamp');
    const webhookSignature = request.headers.get('webhook-signature');

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.warn('[Okendo Webhook] Missing Svix signature headers');
    } else {
      const isValid = await verifySvixSignature({
        secret,
        webhookId,
        webhookTimestamp,
        webhookSignature,
        rawBody,
      });

      if (!isValid) {
        console.error('[Okendo Webhook] Signature mismatch');
        return new Response('Unauthorized', {
          status: 401,
          headers: corsHeaders,
        });
      }
    }
  }

  // Fire-and-forget, but keep the worker alive via waitUntil so the async
  // POST to Triple Whale completes after this response is returned. They
  // require a 200 within 15s, so we don't await it inline.
  context.waitUntil?.(
    processOkendoWebhook(payload, context.env.TRIPLE_WHALE_API_KEY, context.env.PUBLIC_STORE_DOMAIN).catch(
      (err) => console.error('[Okendo Webhook] Async processing failed:', err),
    ),
  );

  return new Response('OK', {status: 200, headers: corsHeaders});
}

async function verifySvixSignature({
  secret,
  webhookId,
  webhookTimestamp,
  webhookSignature,
  rawBody,
}: {
  secret: string;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  rawBody: string;
}): Promise<boolean> {
  // Svix secret: strip "whsec_" prefix, then base64-decode to get the raw key
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signedContent) as BufferSource,
  );
  const computed = bytesToBase64(new Uint8Array(signatureBuffer));

  // webhook-signature can contain multiple signatures like "v1,<sig1> v1,<sig2>"
  const signatures = webhookSignature
    .split(' ')
    .map((s) => s.replace(/^v1,/, ''));
  return signatures.some((sig) => sig === computed);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

interface OkendoQuestion {
  id: string;
  type: string;
  text: string;
  answer: unknown;
  answerNpsCategory?: string;
  customAnswer?: string;
  customAnswerOptionText?: string;
  profileQuestionId?: string;
  marketingOptIn?: boolean;
}

interface OkendoWebhookPayload {
  resource: {
    subscriberId: string;
    surveyResponseId: string;
    surveyId: string;
    surveyName: string;
    dateCreated: string;
    channel: string;
    channelSurveyId?: string;
    channelSurveyDescription?: string;
    customer: {
      customerId: string;
      email: string;
    };
    order: {
      remoteOrderId: string;
    };
    answeredQuestions: OkendoQuestion[];
    reward?: {
      description: string;
      type: string;
      value: string;
    };
  };
  resourceType: string;
  sequenceNumber: string;
  topic: string;
  version: string;
}

interface TripleWhalePPSRecord {
  shop: string;
  order_id: string;
  platform_account_id: string;
  // available fields, but not being used
  // platform: string;
  created_at: string;
  // question_id: string;
  question_text: string;
  // question_type: string;
  // response_id: string;
  response: string;
  // customer_email: string;
  // customer_id: string;
  // survey_type: string;
  // source: string;
}

function formatAnswer(question: OkendoQuestion): string {
  const {answer, customAnswer} = question;
  let formatted: string;

  if (Array.isArray(answer)) {
    formatted = answer.join(', ');
  } else if (typeof answer === 'object' && answer !== null) {
    const typed = answer as {type?: string; value?: unknown};
    if (typed.value !== undefined) {
      if (Array.isArray(typed.value)) formatted = typed.value.join(', ');
      else if (typeof typed.value === 'object' && typed.value !== null) {
        formatted = JSON.stringify(typed.value);
      } else {
        formatted = String(typed.value);
      }
    } else {
      formatted = JSON.stringify(answer);
    }
  } else {
    formatted = String(answer);
  }

  if (customAnswer) {
    formatted += ` (Other: ${customAnswer.trim()})`;
  }

  return formatted;
}

function buildPPSRecords(payload: OkendoWebhookPayload, publicStoreDomain: string): TripleWhalePPSRecord[] {
  const {resource} = payload;

  return resource.answeredQuestions.map((q) => ({
    shop: publicStoreDomain,
    order_id: resource.order.remoteOrderId,
    platform_account_id: resource.subscriberId,
    // available fields, but not being used
    // platform: "okendo",
    created_at: resource.dateCreated,
    // question_id: q.id,
    question_text: q.text,
    // question_type: "standard",
    // response_id: resource.surveyResponseId,
    response: formatAnswer(q),
    // customer_email: resource.customer.email,
    // customer_id: resource.customer.customerId,
    // survey_type: "okendo",
    // source: "pps-okendo",
  }));
}

async function processOkendoWebhook(
  payload: unknown,
  apiKey: string | undefined,
  publicStoreDomain: string,
) {
  const typed = payload as OkendoWebhookPayload;

  if (typed.resourceType !== 'survey_response') {
    console.log(
      `[Okendo Webhook] Ignoring non-survey resource type: ${typed.resourceType}`,
    );
    return;
  }

  const ppsRecords = buildPPSRecords(typed, publicStoreDomain);

  if (!apiKey) {
    console.error(
      '[Okendo Webhook] TRIPLE_WHALE_API_KEY is not set — skipping POST to Triple Whale',
    );
    return;
  }

  const results = await Promise.allSettled(
    ppsRecords.map(async (record, i) => {
      const res = await fetch('https://api.triplewhale.com/api/v2/data-in/pps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(record),
      });

      const body = await res.text();
      if (!res.ok) {
        console.error(
          `[Okendo Webhook] Triple Whale PPS #${i + 1} failed (${res.status}):`,
          body
        );
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      return body;
    }),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.error(
      `[Okendo Webhook] ${failed}/${ppsRecords.length} Triple Whale PPS record(s) failed`,
    );
  }
}
