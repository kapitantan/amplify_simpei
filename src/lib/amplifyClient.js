import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";

function parseAmplifyOutputs() {
  const rawOutputs = import.meta.env.VITE_AMPLIFY_OUTPUTS_JSON;

  if (!rawOutputs) {
    return null;
  }

  try {
    return JSON.parse(rawOutputs);
  } catch (error) {
    console.error("Failed to parse VITE_AMPLIFY_OUTPUTS_JSON.", error);
    return null;
  }
}

const outputs = parseAmplifyOutputs();

if (outputs) {
  Amplify.configure(outputs);
}

export const client = outputs
  ? generateClient({
      authMode: "identityPool",
    })
  : null;

export const noteModel = client?.models?.Note ?? client?.models?.Todo ?? null;
export const usesTodoFallback =
  !client?.models?.Note && Boolean(client?.models?.Todo);
