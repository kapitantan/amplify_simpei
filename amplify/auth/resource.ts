import { defineAuth } from '@aws-amplify/backend';
import { createAuthChallenge } from './custom-auth/create-challenge/resource';
import { defineAuthChallenge } from './custom-auth/define-challenge/resource';
import { verifyAuthChallengeResponse } from './custom-auth/verify-challenge/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  triggers: {
    defineAuthChallenge,
    createAuthChallenge,
    verifyAuthChallengeResponse,
  },
});
