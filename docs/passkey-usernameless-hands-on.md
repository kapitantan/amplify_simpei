# Usernameless Passkey Custom Auth Hands-on

このドキュメントは、Cognito custom authentication で username を入力しない passkey 認証を理解しながら実装するためのハンズオンです。

最初から完成形を作らず、各ステップで「何を作ったか」「どう動作確認するか」「次に何が必要になるか」を確認して進めます。

## ゴール

最終的に作りたい流れはこれです。

```text
ユーザーが「パスキーでログイン」を押す
-> 公開 API が WebAuthn challenge を発行する
-> ブラウザが navigator.credentials.get() を呼ぶ
-> passkey が署名と userHandle を返す
-> userHandle から内部 Cognito username を解決する
-> Cognito custom auth を開始する
-> VerifyAuthChallengeResponse で署名を検証する
-> Cognito が token を発行する
```

重要なのは、Cognito 自体は内部的に username を必要とすることです。

この方式でいう「username を用いない」は、ユーザーに username / email を入力させない、という意味です。内部では passkey の `userHandle` から Cognito username を解決します。

## 先に覚える用語

### Passkey

ユーザー端末やパスワードマネージャーに保存される認証情報です。秘密鍵は端末側にあり、サーバーには公開鍵だけを保存します。

### WebAuthn

ブラウザの標準 API です。

```text
navigator.credentials.create()
  passkey 登録で使う

navigator.credentials.get()
  passkey ログインで使う
```

### FIDO2 credential

passkey 登録で作成される認証器情報です。サーバー側には主に以下を保存します。

```text
credentialId
publicKey
signCount
userHandle
cognitoUsername
```

### challenge

サーバーが発行するランダム文字列です。ブラウザはこの challenge に対して署名します。

challenge は使い捨てです。検証後は削除します。

### userHandle

passkey に紐づく opaque なユーザー識別子です。メールアドレスのような readable な値は入れません。

おすすめは次のどちらかです。

```text
userHandle = Cognito username
```

または、

```text
userHandle -> DynamoDB -> Cognito username
```

## 全体アーキテクチャ

```text
React
  |
  | POST /sign-in-challenge
  v
API Gateway
  |
  v
Lambda: sign-in-challenge
  |
  v
DynamoDB: PasskeyChallenges

React
  |
  | navigator.credentials.get()
  v
Passkey / Authenticator

React
  |
  | Cognito custom auth
  v
Cognito User Pool
  |
  | DefineAuthChallenge
  | CreateAuthChallenge
  | VerifyAuthChallengeResponse
  v
Lambda triggers
  |
  v
DynamoDB: PasskeyCredentials / PasskeyChallenges
```

## 学習の進め方

各ステップは次の形で進めます。

```text
1. 小さい実装を追加する
2. そのステップだけ動作確認する
3. 何が分かったかメモする
4. 次のステップに進む
```

一気に Cognito custom auth まで作らないのが大事です。WebAuthn は失敗時の原因が分かりにくいので、分解して確認します。

## Step 0: 現在地を確認する

このステップでは実装しません。まずリポジトリの状態を確認します。

確認すること:

```bash
git status --short
npm run build
```

期待する状態:

```text
passkey 用の API / Lambda / DynamoDB はまだない
既存の Amplify auth / data / storage はそのまま
フロントは既存アプリとして build できる
```

ここでの理解:

```text
今はまだ passkey 認証の実装前
これから部品を 1 つずつ足していく
```

## Step 1: ブラウザで WebAuthn API の存在だけ確認する

最初は AWS を触りません。ブラウザが passkey API を使えるかだけ確認します。

確認すること:

```js
window.PublicKeyCredential
```

ブラウザの devtools console で `function` が返れば WebAuthn API が使えます。

期待する状態:

```text
Chrome / Safari / Edge などで PublicKeyCredential が存在する
localhost または https で動かす必要があると理解する
```

ここでの理解:

```text
passkey はブラウザ API と OS / password manager の共同作業
HTTP の本番ドメインでは動かない
localhost は開発用に許可される
```

## Step 2: WebAuthn のデータ形式を理解する

WebAuthn API は `ArrayBuffer` を多く使います。一方、HTTP JSON では `ArrayBuffer` をそのまま送れません。

そのため、実装では必ず変換が必要になります。

```text
server
  base64url string の challenge を返す

browser
  base64url string を ArrayBuffer に戻して navigator.credentials.get() に渡す

browser
  authenticator response の ArrayBuffer を base64url string にして server に送る
```

確認すること:

```text
base64url <-> ArrayBuffer の helper を作る
ブラウザ console で往復変換できるか確認する
```

期待する状態:

```text
"abc123" のような文字列ではなく、ランダム bytes を base64url 化して扱う、と理解する
```

ここでの理解:

```text
WebAuthn の多くの値はバイナリ
JSON で送るには base64url にする
```

## Step 3: PasskeyChallenges テーブルだけ作る

ここで初めて DynamoDB を追加します。

このテーブルは、一時 challenge を保存するためのものです。

保存する項目:

```text
challengeId
challenge
type = authentication
rpId
origin
createdAt
expiresAt
```

設計例:

```text
PK: challengeId
TTL attribute: expiresAt
```

確認すること:

```bash
npx ampx sandbox
```

または Amplify deploy 後に AWS console で DynamoDB テーブルができているか確認します。

期待する状態:

```text
PasskeyChallenges テーブルが作成される
TTL が expiresAt に設定される
まだ API はない
```

ここでの理解:

```text
challenge は永続データではない
認証ごとに発行し、検証後に削除する
TTL は期限切れデータの掃除用
```

## Step 4: 公開 API /sign-in-challenge を作る

このステップで未ログインでも呼べる公開 API を作ります。

責務:

```text
1. ランダム challenge を生成する
2. challengeId を生成する
3. DynamoDB に challenge を保存する
4. navigator.credentials.get() 用の publicKey options を返す
```

レスポンス例:

```json
{
  "challengeId": "uuid",
  "publicKey": {
    "challenge": "base64url-random-challenge",
    "rpId": "localhost",
    "timeout": 60000,
    "userVerification": "required",
    "allowCredentials": []
  },
  "expiresAt": 1234567890
}
```

重要ポイント:

```text
allowCredentials: []
```

usernameless passkey login では、特定の credentialId を先に指定しません。ブラウザ / OS に「この RP ID に対応する passkey を探して」と任せます。

確認すること:

```bash
curl -X POST https://example.execute-api.ap-northeast-1.amazonaws.com/prod/sign-in-challenge
```

期待する状態:

```text
200 OK が返る
challengeId が返る
publicKey.challenge が返る
DynamoDB に challenge item が保存される
expiresAt が入っている
```

ここでの理解:

```text
/sign-in-challenge は Cognito の前段
まだ Cognito custom auth は始まっていない
この API は署名対象の challenge を発行するだけ
```

## Step 5: フロントで navigator.credentials.get() を呼ぶ

ここでは Cognito に進みません。ブラウザが passkey UI を出せるかだけ確認します。

やること:

```text
1. /sign-in-challenge を呼ぶ
2. publicKey.challenge を ArrayBuffer に変換する
3. navigator.credentials.get({ publicKey }) を呼ぶ
```

まだ登録済み passkey がない場合:

```text
ブラウザが passkey を見つけられず失敗する
```

これは正常です。

期待する状態:

```text
passkey UI が表示される、または「使える passkey がない」エラーになる
```

ここでの理解:

```text
challenge API と WebAuthn get() はつながった
しかし credential が未登録なら認証はできない
```

## Step 6: PasskeyCredentials テーブルを作る

次に、登録済み passkey の公開鍵を保存するテーブルを作ります。

保存する項目:

```text
credentialId
userHandle
cognitoUsername
publicKey
signCount
transports
createdAt
lastUsedAt
```

usernameless login では、ログイン時に credentialId または userHandle から `cognitoUsername` を解決できる必要があります。

設計例:

```text
PK: credentialId
GSI: userHandle
```

期待する状態:

```text
credentialId から公開鍵を引ける
userHandle から cognitoUsername を引ける
```

ここでの理解:

```text
Cognito username はユーザー入力しないだけで、内部的には必要
passkey の userHandle が Cognito username 解決の入口になる
```

## Step 7: passkey 登録フローを作る

usernameless login の前に、登録済み passkey が必要です。

登録フロー:

```text
1. ユーザーは何らかの方法でログイン済み
2. register-start API が registration challenge を返す
3. ブラウザが navigator.credentials.create() を呼ぶ
4. register-complete API が attestation を検証する
5. publicKey / credentialId / userHandle を DynamoDB に保存する
```

このハンズオンでは、最初は開発用に固定ユーザーで登録しても構いません。

ただし本番では、登録は必ず認証済みユーザーに対して行います。

確認すること:

```text
DynamoDB PasskeyCredentials に credential が保存される
credentialId が入る
publicKey が入る
userHandle が入る
```

ここでの理解:

```text
ログインは登録済み credential がないと成立しない
登録はログインとは別フロー
```

## Step 8: Verify 用の署名検証を単体で確認する

まだ Cognito に入らず、署名検証だけを Lambda かローカルで確認します。

使うライブラリ候補:

```text
@simplewebauthn/server
@simplewebauthn/browser
```

検証すること:

```text
challenge が一致する
origin が正しい
rpId が正しい
credentialId が登録済み
signature が publicKey で検証できる
signCount が不正に巻き戻っていない
```

期待する状態:

```text
正しい passkey assertion なら検証成功
challenge を変えると失敗
origin を変えると失敗
```

ここでの理解:

```text
passkey 認証の本体は公開鍵署名検証
Cognito custom auth はその結果を token 発行に変換する仕組み
```

## Step 9: Cognito custom auth trigger を追加する

ここで初めて Cognito custom auth に入ります。

必要な trigger:

```text
DefineAuthChallenge
CreateAuthChallenge
VerifyAuthChallengeResponse
```

ただし usernameless の場合、Cognito 開始前に `userHandle -> cognitoUsername` の解決が必要です。

流れ:

```text
1. /sign-in-challenge で challenge を発行
2. navigator.credentials.get() で assertion を取得
3. assertion.userHandle から cognitoUsername を解決
4. signIn({ username: cognitoUsername, authFlowType: CUSTOM_WITHOUT_SRP })
5. confirmSignIn({ challengeResponse: assertion + challengeId })
6. VerifyAuthChallengeResponse で署名検証
7. 成功なら Cognito token 発行
```

確認すること:

```text
VerifyAuthChallengeResponse の answerCorrect が true になる
DefineAuthChallenge が issueTokens = true にする
フロントで Cognito session が取れる
```

ここでの理解:

```text
Cognito は username を完全に不要にはできない
ユーザー入力を省略し、passkey から内部 username を解決する
```

## Step 10: replay protection を確認する

challenge は使い回せてはいけません。

確認すること:

```text
同じ challengeId と assertion を 2 回送る
1 回目は成功
2 回目は失敗
```

実装の考え方:

```text
Verify 時に PasskeyChallenges から challenge を取得する
検証前後で challenge item を削除する
削除済み challengeId は再利用できない
```

ここでの理解:

```text
署名が正しくても、challenge の再利用は拒否する
```

## Step 11: エラーを分類する

passkey 実装では失敗理由を分けて見ることが重要です。

分類例:

```text
No passkey
  端末に対応する passkey がない

Challenge expired
  challenge の TTL が切れている

Challenge mismatch
  clientDataJSON の challenge が保存値と違う

Origin mismatch
  想定外の origin から来ている

Unknown credential
  credentialId が DynamoDB にない

Signature invalid
  署名検証に失敗

Counter rollback
  signCount が巻き戻っている
```

期待する状態:

```text
CloudWatch Logs で原因を追える
フロントには安全な一般メッセージだけ出す
```

## Step 12: 完成形に近づける

ここまでできたら、完成形として以下を整えます。

```text
登録済み passkey の一覧表示
passkey の削除
複数端末の登録
origin / rpId の環境別設定
CloudWatch Logs の整理
API throttling
DynamoDB TTL / cleanup
IAM 権限の最小化
```

## 実装順チェックリスト

```text
[ ] Step 1: WebAuthn API の存在確認
[ ] Step 2: base64url / ArrayBuffer helper
[ ] Step 3: PasskeyChallenges テーブル
[ ] Step 4: /sign-in-challenge API
[ ] Step 5: navigator.credentials.get() 呼び出し
[ ] Step 6: PasskeyCredentials テーブル
[ ] Step 7: passkey 登録フロー
[ ] Step 8: 署名検証の単体確認
[ ] Step 9: Cognito custom auth trigger
[ ] Step 10: replay protection
[ ] Step 11: エラー分類
[ ] Step 12: 運用向け整理
```

## 次に実装するなら

最初の実装タスクは、まだ AWS を触らずにこれだけで十分です。

```text
Step 1: ブラウザで PublicKeyCredential が存在するか確認
Step 2: base64url <-> ArrayBuffer helper を作ってテスト
```

ここが理解できると、`/sign-in-challenge` が返す `publicKey.challenge` をなぜ変換する必要があるのかが分かります。

その次に `PasskeyChallenges` テーブルと `/sign-in-challenge` API に進みます。

---

# 具体コード付きハンズオン

ここからは、実際にどのフォルダに何を置くかまで具体化します。

ただし、この章のコードは「一気に全部入れる」ためのものではありません。各 Step ごとに追加し、動作確認したら次へ進みます。

## Step A: WebAuthn 変換 helper を作る

最初に AWS は触りません。WebAuthn で必ず必要になる base64url と `ArrayBuffer` の変換 helper を作ります。

作るファイル:

```text
src/lib/webauthn/base64url.js
```

コード:

```js
export function base64UrlToArrayBuffer(base64url) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = `${base64url}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
```

確認用に、一時的にブラウザ console で試します。

```js
const bytes = crypto.getRandomValues(new Uint8Array(32));
const encoded = arrayBufferToBase64Url(bytes.buffer);
const decoded = base64UrlToArrayBuffer(encoded);
new Uint8Array(decoded).length;
```

期待値:

```text
32
```

ここで分かること:

```text
WebAuthn はバイナリ値を扱う
HTTP JSON では base64url string にして送る
```

## Step B: WebAuthn get() の呼び出しだけ試す

まだ API は作りません。固定 challenge を使って `navigator.credentials.get()` が呼べるか確認します。

作るファイル:

```text
src/lib/webauthn/getPasskeyAssertion.js
```

コード:

```js
import { arrayBufferToBase64Url, base64UrlToArrayBuffer } from "./base64url";

export async function getPasskeyAssertion(publicKeyOptions) {
  const credential = await navigator.credentials.get({
    publicKey: {
      ...publicKeyOptions,
      challenge: base64UrlToArrayBuffer(publicKeyOptions.challenge),
      allowCredentials: (publicKeyOptions.allowCredentials ?? []).map((credentialDescriptor) => ({
        ...credentialDescriptor,
        id: base64UrlToArrayBuffer(credentialDescriptor.id),
      })),
    },
  });

  if (!credential) {
    throw new Error("No passkey credential was selected.");
  }

  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: arrayBufferToBase64Url(credential.response.authenticatorData),
      clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
      signature: arrayBufferToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? arrayBufferToBase64Url(credential.response.userHandle)
        : null,
    },
  };
}
```

一時的に `src/pages/AuthPage.jsx` のボタンから呼び出してみます。

例:

```jsx
import { Button } from "@aws-amplify/ui-react";
import { useState } from "react";
import { getPasskeyAssertion } from "../lib/webauthn/getPasskeyAssertion";

const demoPublicKey = {
  challenge: "uZ7J8zF3aLmejLhK9wW_K8vC2Qz7qTQDPnH4xS3wG8U",
  rpId: "localhost",
  timeout: 60000,
  userVerification: "required",
  allowCredentials: [],
};

export default function AuthPage() {
  const [message, setMessage] = useState("");

  async function handlePasskeyTest() {
    try {
      const assertion = await getPasskeyAssertion(demoPublicKey);
      setMessage(JSON.stringify(assertion, null, 2));
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="auth-page">
      <Button variation="primary" onClick={handlePasskeyTest}>
        パスキーを試す
      </Button>
      <pre>{message}</pre>
    </main>
  );
}
```

確認:

```bash
npm run dev
```

期待する状態:

```text
登録済み passkey がない場合:
  passkey が見つからない、または認証できないエラーになる

登録済み passkey がある場合:
  ブラウザ / OS の passkey UI が出る
```

この Step の目的は、成功ログインではありません。`navigator.credentials.get()` の入り口を体験することです。

## Step C: Challenge テーブルを追加する

ここから AWS 側に入ります。最初は DynamoDB テーブルだけ作ります。

編集するファイル:

```text
amplify/backend.ts
```

追加する import:

```ts
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
```

`defineBackend` の戻り値を変数にします。

変更前:

```ts
defineBackend({
  auth,
  data,
  storage
});
```

変更後:

```ts
const backend = defineBackend({
  auth,
  data,
  storage
});
```

その下に追加します。

```ts
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
```

確認:

```bash
npx tsc --noEmit -p amplify/tsconfig.json
```

期待する状態:

```text
TypeScript エラーが出ない
まだ Lambda も API もない
```

ここで分かること:

```text
Amplify Gen 2 では backend.ts に CDK construct を追加できる
DynamoDB TTL は expiresAt という数値属性で設定する
```

## Step D: /sign-in-challenge 用 Lambda を作る

次に challenge を発行する Lambda を作ります。

作るフォルダ:

```text
amplify/functions/sign-in-challenge/
```

作るファイル:

```text
amplify/functions/sign-in-challenge/resource.ts
amplify/functions/sign-in-challenge/handler.ts
```

依存を追加します。

```bash
npm install @aws-sdk/client-dynamodb
npm install -D @types/node
```

`amplify/tsconfig.json` に Node 型を追加します。

```json
{
  "compilerOptions": {
    "types": ["node"]
  }
}
```

実際には既存の `compilerOptions` の中に `"types": ["node"]` を足します。

`resource.ts`:

```ts
import { defineFunction } from '@aws-amplify/backend';

export const signInChallenge = defineFunction({
  name: 'sign-in-challenge',
  entry: './handler.ts',
  timeoutSeconds: 10,
  environment: {
    PASSKEY_CHALLENGE_TTL_SECONDS: '300',
  },
});
```

`handler.ts`:

```ts
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
  if (origin) {
    try {
      return new URL(origin).hostname;
    } catch {
      return fallbackRpId;
    }
  }

  return fallbackRpId;
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
```

ここで確認:

```bash
npx tsc --noEmit -p amplify/tsconfig.json
```

期待する状態:

```text
Lambda handler の型エラーがない
まだ API Gateway にはつながっていない
```

ここで分かること:

```text
Lambda は challenge を作って DynamoDB に保存するだけ
passkey の署名検証はまだしない
```

## Step E: Lambda を backend.ts に登録する

編集するファイル:

```text
amplify/backend.ts
```

追加 import:

```ts
import { signInChallenge } from './functions/sign-in-challenge/resource';
```

`defineBackend` に追加:

```ts
const backend = defineBackend({
  auth,
  data,
  signInChallenge,
  storage
});
```

DynamoDB への書き込み権限と環境変数を追加:

```ts
passkeyChallengesTable.grantWriteData(backend.signInChallenge.resources.lambda);
backend.signInChallenge.addEnvironment(
  'PASSKEY_CHALLENGES_TABLE_NAME',
  passkeyChallengesTable.tableName
);
```

確認:

```bash
npx tsc --noEmit -p amplify/tsconfig.json
```

期待する状態:

```text
Lambda が Amplify backend に登録される
Lambda から PasskeyChallenges に PutItem できる IAM 権限が付く
Lambda に PASSKEY_CHALLENGES_TABLE_NAME が渡る
```

ここで分かること:

```text
CDK では grantWriteData() で IAM 権限を付ける
Amplify function には addEnvironment() で環境変数を渡せる
```

## Step F: API Gateway を作る

編集するファイル:

```text
amplify/backend.ts
```

追加 import:

```ts
import { Duration } from 'aws-cdk-lib';
import { AuthorizationType, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
```

`passkeyChallengesTable` の下あたりに追加:

```ts
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
```

フロントから API URL を読めるように出力します。

```ts
backend.addOutput({
  custom: {
    passkeyApi: {
      endpoint: passkeyApi.url,
      signInChallengePath: 'sign-in-challenge',
    },
  },
});
```

確認:

```bash
npx tsc --noEmit -p amplify/tsconfig.json
npm run build
```

期待する状態:

```text
TypeScript が通る
build が通る
amplify_outputs.json の custom.passkeyApi に API URL が出る準備ができる
```

deploy 後の確認:

```bash
curl -X POST https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/sign-in-challenge
```

期待する JSON:

```json
{
  "challengeId": "uuid",
  "publicKey": {
    "challenge": "base64url",
    "rpId": "your-domain-or-localhost",
    "timeout": 60000,
    "userVerification": "required",
    "allowCredentials": []
  },
  "expiresAt": 1234567890
}
```

ここで分かること:

```text
API Gateway は HTTP endpoint
Lambda は API の中身
DynamoDB は challenge の保存先
```

## Step G: フロントから /sign-in-challenge を呼ぶ

作るファイル:

```text
src/lib/passkey/signInChallenge.js
```

コード:

```js
import outputs from "../../../amplify_outputs.json";

const passkeyApi = outputs.custom?.passkeyApi;

export async function startSignInChallenge() {
  if (!passkeyApi?.endpoint) {
    throw new Error("Passkey API endpoint is not configured.");
  }

  const endpoint = new URL(passkeyApi.signInChallengePath, passkeyApi.endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to start passkey sign-in challenge.");
  }

  return response.json();
}
```

`src/pages/AuthPage.jsx` に一時ボタンを置きます。

```jsx
import { Button } from "@aws-amplify/ui-react";
import { useState } from "react";
import { startSignInChallenge } from "../lib/passkey/signInChallenge";

export default function AuthPage() {
  const [message, setMessage] = useState("");

  async function handleStartChallenge() {
    try {
      const result = await startSignInChallenge();
      setMessage(JSON.stringify(result, null, 2));
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="auth-page">
      <Button variation="primary" onClick={handleStartChallenge}>
        challenge を発行
      </Button>
      <pre>{message}</pre>
    </main>
  );
}
```

確認:

```text
ブラウザでボタンを押す
challengeId と publicKey.challenge が画面に出る
DynamoDB に同じ challengeId の item が保存される
```

ここで分かること:

```text
React -> API Gateway -> Lambda -> DynamoDB の線がつながった
まだ passkey UI は出していない
```

## Step H: challenge から navigator.credentials.get() を呼ぶ

`src/pages/AuthPage.jsx` のボタン処理を更新します。

```jsx
import { Button } from "@aws-amplify/ui-react";
import { useState } from "react";
import { startSignInChallenge } from "../lib/passkey/signInChallenge";
import { getPasskeyAssertion } from "../lib/webauthn/getPasskeyAssertion";

export default function AuthPage() {
  const [message, setMessage] = useState("");

  async function handlePasskeySignIn() {
    try {
      const challenge = await startSignInChallenge();
      const assertion = await getPasskeyAssertion(challenge.publicKey);

      setMessage(
        JSON.stringify(
          {
            challengeId: challenge.challengeId,
            assertion,
          },
          null,
          2
        )
      );
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <main className="auth-page">
      <Button variation="primary" onClick={handlePasskeySignIn}>
        パスキーでログイン
      </Button>
      <pre>{message}</pre>
    </main>
  );
}
```

確認:

```text
登録済み passkey がない:
  passkey が見つからないエラーになる

登録済み passkey がある:
  assertion JSON が表示される
```

この時点では、assertion をまだ Cognito に送っていません。

ここで分かること:

```text
challenge API と WebAuthn get() が接続できた
次は登録済み credential と署名検証が必要
```

## Step I: Credentials テーブルを作る

編集するファイル:

```text
amplify/backend.ts
```

`PasskeyChallenges` の近くに追加します。

```ts
const passkeyCredentialsTable = new Table(passkeyStack, 'PasskeyCredentials', {
  partitionKey: {
    name: 'credentialId',
    type: AttributeType.STRING,
  },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
});

passkeyCredentialsTable.addGlobalSecondaryIndex({
  indexName: 'ByUserHandle',
  partitionKey: {
    name: 'userHandle',
    type: AttributeType.STRING,
  },
});
```

保存する item のイメージ:

```json
{
  "credentialId": "base64url",
  "userHandle": "opaque-user-handle",
  "cognitoUsername": "internal-cognito-username",
  "publicKey": "base64url-or-pem",
  "signCount": 0,
  "createdAt": 1234567890,
  "lastUsedAt": 1234567890
}
```

確認:

```bash
npx tsc --noEmit -p amplify/tsconfig.json
```

期待する状態:

```text
PasskeyCredentials テーブルが作れる
credentialId で credential を引ける
userHandle で cognitoUsername を解決できる
```

ここで分かること:

```text
usernameless でも Cognito username は内部的に必要
userHandle は username 解決の鍵
```

## Step J: 登録フローは別 API として作る

ログインの前に passkey 登録が必要です。

登録用 API は login API と分けます。

作る予定のフォルダ:

```text
amplify/functions/passkey-register-start/
amplify/functions/passkey-register-complete/
```

登録 start の役割:

```text
registration challenge を作る
userHandle を決める
navigator.credentials.create() 用 options を返す
```

登録 complete の役割:

```text
attestation response を検証する
credentialId / publicKey / signCount を取り出す
PasskeyCredentials に保存する
```

この段階で入れるライブラリ候補:

```bash
npm install @simplewebauthn/server @simplewebauthn/browser
```

ここでの注意:

```text
passkey 登録は、原則としてログイン済みユーザーに対して行う
開発初期だけ固定ユーザーで試してもよい
本番では未認証で register-complete できる設計にしない
```

## Step K: Cognito custom auth trigger を作る

最後に Cognito custom auth に接続します。

作る予定のフォルダ:

```text
amplify/auth/custom-auth/define-challenge/
amplify/auth/custom-auth/create-challenge/
amplify/auth/custom-auth/verify-challenge/
```

`define-challenge/handler.ts` の役割:

```text
custom challenge 成功済みなら issueTokens = true
失敗が多すぎたら failAuthentication = true
それ以外は CUSTOM_CHALLENGE を出す
```

`create-challenge/handler.ts` の役割:

```text
Cognito の custom auth セッション用 challenge を作る
ただし usernameless では、本体 challenge は /sign-in-challenge で作成済み
必要なら challengeId を public/private parameter に受け渡す
```

`verify-challenge/handler.ts` の役割:

```text
confirmSignIn の challengeResponse を読む
challengeId で PasskeyChallenges から challenge を取得
credentialId で PasskeyCredentials から publicKey を取得
@simplewebauthn/server で assertion を検証
成功なら answerCorrect = true
challenge を削除して replay を防ぐ
```

ここで初めて Cognito token 発行まで進みます。

## 最小の学習順

実際にはこの順で進むのがおすすめです。

```text
1. Step A: base64url helper
2. Step B: navigator.credentials.get() の入口確認
3. Step C: PasskeyChallenges テーブル
4. Step D: sign-in-challenge Lambda
5. Step E: Lambda と DynamoDB 接続
6. Step F: API Gateway 接続
7. Step G: フロントから challenge API を呼ぶ
8. Step H: challenge で navigator.credentials.get()
9. Step I: PasskeyCredentials テーブル
10. Step J: passkey 登録
11. Step K: Cognito custom auth
```

Step H までは「ログイン成功」しなくて大丈夫です。

そこまでの目的は、次の線を理解することです。

```text
React -> API Gateway -> Lambda -> DynamoDB -> React -> WebAuthn
```

Cognito custom auth は、その後に接続します。
