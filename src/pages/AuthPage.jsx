import { Button } from "@aws-amplify/ui-react";
import { useNavigate } from "react-router-dom";

export default function AuthPage() {
  const navigate = useNavigate();

  return (
    <main className="auth-page">
      <Button variation="primary" onClick={() => navigate("/notes")}>
        ログイン
      </Button>
    </main>
  );
}
