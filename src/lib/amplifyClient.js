import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "../../amplify_outputs.json";

Amplify.configure(outputs);

export const client = generateClient({
  authMode: "identityPool",
});

export const noteModel = client.models.Note ?? client.models.Todo;
export const usesTodoFallback = !client.models.Note && Boolean(client.models.Todo);
