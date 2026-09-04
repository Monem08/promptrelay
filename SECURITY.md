# Security Policy

## Reporting a vulnerability

Please avoid publishing API keys, private prompts, private source code, or exploit details in a public issue.

For sensitive reports, contact the repository owner privately through an available GitHub contact channel before public disclosure.

## Operational guidance

- Keep PromptRelay bound to `127.0.0.1` unless you add your own access controls and TLS.
- Store provider credentials in environment variables, not source files.
- Rotate any key that is accidentally committed or shared.
- Treat `system_prompt.txt` as potentially sensitive if it contains internal instructions.
- Remember that request content is forwarded to the configured upstream provider.

PromptRelay cannot override provider-side security, account restrictions, or platform policies.
