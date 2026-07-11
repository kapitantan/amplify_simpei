import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "../../amplify_outputs.json";

export const isAmplifyConfigured = Boolean(outputs);

if (isAmplifyConfigured) {
  Amplify.configure(outputs);
}

export const client = isAmplifyConfigured
  ? generateClient({
      authMode: "identityPool",
    })
  : null;

export const noteModel = client?.models.Note ?? client?.models.Todo ?? null;
export const usesTodoFallback =
  !client?.models.Note && Boolean(client?.models.Todo);
