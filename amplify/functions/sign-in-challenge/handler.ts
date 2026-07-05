import { randomBytes, randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventHeaders, APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});
const challengeTableName = process.env.PASSKEY_CHALLENGES_TABLE_NAME;
const fallbackRpId = process.env.PASSKEY_RP_ID;
const challengeTtlSeconds = Number(process.env.PASSKEY_CHALLENGE_TTL_SECONDS ?? '300');

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'OPTIONS,POST',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getOrigin(headers: APIGatewayProxyEventHeaders) {
  return headers.origin ?? headers.Origin;
}

function getRpId(origin?: string) {
  if (!origin) {
    return fallbackRpId;
  }

  try {
    return new URL(origin).hostname;
  } catch {
    return fallbackRpId;
  }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method Not Allowed' });
  }

  const origin = getOrigin(event.headers);
  const rpId = getRpId(origin);

  if (!challengeTableName || !rpId) {
    return jsonResponse(500, { message: 'Passkey challenge API is not configured.' });
  }

  const challengeId = randomUUID();
  const challenge = toBase64Url(randomBytes(32));
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + challengeTtlSeconds;

  await dynamodb.send(
    new PutItemCommand({
      TableName: challengeTableName,
      Item: {
        challengeId: { S: challengeId },
        challenge: { S: challenge },
        type: { S: 'authentication' },
        rpId: { S: rpId },
        createdAt: { N: String(now) },
        expiresAt: { N: String(expiresAt) },
        ...(origin ? { origin: { S: origin } } : {}),
      },
      ConditionExpression: 'attribute_not_exists(challengeId)',
    })
  );

  return jsonResponse(200, {
    challengeId,
    publicKey: {
      challenge,
      rpId,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: [],
    },
    expiresAt,
  });
};
