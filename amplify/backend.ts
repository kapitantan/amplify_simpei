import { defineBackend } from '@aws-amplify/backend';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { AuthorizationType, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { signInChallenge } from './functions/sign-in-challenge/resource';
import { storage } from './storage/resource';
/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  signInChallenge,
  storage
});

const passkeyStack = backend.createStack('passkey');

const passkeyChallengesTable = new Table(passkeyStack, 'PasskeyChallenges', {
  partitionKey: {
    name: 'challengeId',
    type: AttributeType.STRING,
  },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  removalPolicy: RemovalPolicy.DESTROY,
});

passkeyChallengesTable.grantWriteData(backend.signInChallenge.resources.lambda);
backend.signInChallenge.addEnvironment(
  'PASSKEY_CHALLENGES_TABLE_NAME',
  passkeyChallengesTable.tableName
);

const passkeyApi = new RestApi(passkeyStack, 'PasskeyApi', {
  restApiName: 'passkey-api',
  deployOptions: {
    throttlingRateLimit: 20,
    throttlingBurstLimit: 40,
  },
  defaultCorsPreflightOptions: {
    allowOrigins: ['*'],
    allowMethods: ['OPTIONS', 'POST'],
    allowHeaders: ['content-type'],
    maxAge: Duration.days(1),
  },
});

passkeyApi.root
  .addResource('sign-in-challenge')
  .addMethod('POST', new LambdaIntegration(backend.signInChallenge.resources.lambda), {
    authorizationType: AuthorizationType.NONE,
  });

backend.addOutput({
  custom: {
    passkeyApi: {
      endpoint: passkeyApi.url,
      signInChallengePath: 'sign-in-challenge',
    },
  },
});
