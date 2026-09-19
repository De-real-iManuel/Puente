# Chat setup on Render

Use the new service at https://puente-zo4d.onrender.com while testing the repair branch.

In that service's Environment settings:

- `GROQ_API_KEY`: your private Groq key. For existing deployments, a Groq key starting with `gsk_` in `OPENAI_API_KEY` also works.
- `GROQ_MODEL`: optional; defaults to `openai/gpt-oss-120b`.
- `APP_ACCESS_CODE`: a private random value of at least 16 characters. Enter this same value in the buyer chat.
- `OPERATOR_SECRET`: a different private random value of at least 32 characters. Enter this at `/operator`.

Save and redeploy the repair branch. Values belong only in Render, never in GitHub. Changing access codes does not repair a provider mismatch: the Groq adapter sends model requests to Groq, not OpenAI.

The backend reports which access setting is missing or too short without exposing its value. A 401 when first checking a session is normal before you sign in. A 503 from session creation means the access code has not met the server's requirement; operator setup has its own separate check.

References: https://console.groq.com/docs/openai and https://console.groq.com/docs/responses-api

Provider tests use a mocked response; they do not prove that a deployed key has credit or model access. Payment availability is separate from chat configuration.
