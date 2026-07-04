import type { DefineAuthChallengeTriggerHandler } from 'aws-lambda';

const MAX_CUSTOM_CHALLENGE_ATTEMPTS = 3;

export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session ?? [];
  const lastChallenge = session.at(-1);
  const failedAttempts = session.filter(
    (challenge) =>
      challenge.challengeName === 'CUSTOM_CHALLENGE' &&
      challenge.challengeResult === false
  ).length;

  event.response.issueTokens = false;
  event.response.failAuthentication = false;

  if (lastChallenge?.challengeName === 'CUSTOM_CHALLENGE' && lastChallenge.challengeResult) {
    event.response.issueTokens = true;
    return event;
  }

  if (failedAttempts >= MAX_CUSTOM_CHALLENGE_ATTEMPTS) {
    event.response.failAuthentication = true;
    return event;
  }

  event.response.challengeName = 'CUSTOM_CHALLENGE';
  return event;
};
