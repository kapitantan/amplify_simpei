import type { VerifyAuthChallengeResponseTriggerHandler } from 'aws-lambda';

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const expectedAnswer = event.request.privateChallengeParameters.answer;
  const challengeAnswer = event.request.challengeAnswer.trim();

  event.response.answerCorrect = Boolean(expectedAnswer) && challengeAnswer === expectedAnswer;

  return event;
};
