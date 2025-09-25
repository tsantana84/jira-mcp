import { EnvConfig } from "./schemas.js";

export type Config = {
  baseUrl: string;
  email: string;
  apiToken: string;
  defaults: {
    projectKey?: string;
    issueType?: string;
  };
};

export function loadConfig(): Config {
  const parsed = EnvConfig.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Invalid environment. Missing or invalid: ${issues}`);
  }
  const env = parsed.data;
  return {
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    defaults: {
      projectKey: env.DEFAULT_PROJECT_KEY,
      issueType: env.DEFAULT_ISSUE_TYPE,
    },
  };
}

