import type { CreateAuthChallengeTriggerHandler } from 'aws-lambda';

const CODE_LENGTH = 6;
const CHALLENGE_METADATA = 'CUSTOM_CHALLENGE_CODE';

function createVerificationCode() {
  return Array.from({ length: CODE_LENGTH }, () => Math.floor(Math.random() * 10)).join('');
}

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const answer = createVerificationCode();

  event.response.publicChallengeParameters = {
    delivery: event.request.userAttributes.email ? 'email' : 'manual',
  };
  event.response.privateChallengeParameters = {
    answer,
  };
  event.response.challengeMetadata = CHALLENGE_METADATA;

  // Replace this with SES/SNS or your existing notification service before production.
  console.info('Custom auth challenge created', {
    username: event.userName,
    destination: event.request.userAttributes.email,
    code: answer,
  });

  return event;
};
