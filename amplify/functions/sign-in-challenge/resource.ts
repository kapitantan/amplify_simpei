import { defineFunction } from '@aws-amplify/backend';

export const signInChallenge = defineFunction({
  name: 'sign-in-challenge',
  entry: './handler.ts',
  timeoutSeconds: 10,
  environment: {
    PASSKEY_CHALLENGE_TTL_SECONDS: '300',
    PASSKEY_RP_ID: 'localhost',
  },
});
