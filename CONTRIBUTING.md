# Contributing to Atlas

Welcome, and thank you for your interest in contributing to Atlas!

## Asking Questions

Have a question? Open a [discussion](https://github.com/skywalkerx28/Atlas/discussions) or file an [issue](https://github.com/skywalkerx28/Atlas/issues).

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/skywalkerx28/Atlas/issues/new) with:

- Your operating system and Atlas version
- Reproducible steps (1... 2... 3...)
- What you expected vs. what happened
- Screenshots or recordings if applicable
- Errors from the Dev Tools Console (Help > Toggle Developer Tools)

Search [existing issues](https://github.com/skywalkerx28/Atlas/issues) before filing a new one.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/skywalkerx28/Atlas.git
   cd Atlas
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile:
   ```bash
   npm run compile
   ```

4. Run:
   ```bash
   bash scripts/code.sh
   ```

## Coding Guidelines

See [.claude/CLAUDE.md](.claude/CLAUDE.md) for the full coding guidelines, including:

- TypeScript style conventions (tabs, naming, types)
- Validation and compilation steps
- Architecture and layering rules
- Code quality requirements

## Pull Requests

- Associate an issue with the pull request
- Ensure the code is up-to-date with the `main` branch
- Include a description of the proposed changes and how to test them
- Run `npm run compile-check-ts-native` to verify no TypeScript errors
- Run `npm run valid-layers-check` to verify no layering violations

## Thank You

Your contributions make Atlas possible. Thank you for taking the time to contribute.
