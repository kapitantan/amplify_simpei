import { useState } from "react";
import { Button, Heading, Text, TextField, View } from "@aws-amplify/ui-react";
import { confirmSignIn, signIn } from "aws-amplify/auth";
import { useNavigate } from "react-router-dom";

export default function AuthPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [challengeSent, setChallengeSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function requestChallenge(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await signIn({
        username,
        options: {
          authFlowType: "CUSTOM_WITHOUT_SRP",
        },
      });

      if (result.isSignedIn || result.nextStep.signInStep === "DONE") {
        navigate("/notes");
        return;
      }

      if (result.nextStep.signInStep !== "CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE") {
        setError(`未対応の認証ステップです: ${result.nextStep.signInStep}`);
        return;
      }

      setChallengeSent(true);
    } catch (caughtError) {
      setError(caughtError.message || "認証コードの作成に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmChallenge(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.target);
    const code = form.get("code");

    try {
      const result = await confirmSignIn({
        challengeResponse: code,
      });

      if (result.isSignedIn || result.nextStep.signInStep === "DONE") {
        navigate("/notes");
        return;
      }

      setError("認証コードを確認できませんでした。もう一度入力してください。");
    } catch (caughtError) {
      setError(caughtError.message || "認証に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <View className="auth-panel">
        <Heading level={1}>ログイン</Heading>
        <Text color="font.tertiary">
          カスタム認証コードでサインインします。
        </Text>

        {!challengeSent ? (
          <View as="form" className="auth-form" onSubmit={requestChallenge}>
            <TextField
              label="メールアドレス"
              name="username"
              type="email"
              autoComplete="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            <Button type="submit" variation="primary" isLoading={isSubmitting}>
              コードを発行
            </Button>
          </View>
        ) : (
          <View as="form" className="auth-form" onSubmit={confirmChallenge}>
            <TextField
              label="認証コード"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
            <Button type="submit" variation="primary" isLoading={isSubmitting}>
              ログイン
            </Button>
            <Button
              type="button"
              variation="link"
              isDisabled={isSubmitting}
              onClick={() => setChallengeSent(false)}
            >
              メールアドレスを変更
            </Button>
          </View>
        )}

        {error && (
          <Text className="auth-error" role="alert">
            {error}
          </Text>
        )}
      </View>
    </main>
  );
}
