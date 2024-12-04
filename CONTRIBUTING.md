# Contributing to Puter

Welcome to Puter, the open-source distributed internet operating system. We're excited to have you contribute to our project, whether you're reporting bugs, suggesting new features, or contributing code. This guide will help you get started with contributing to Puter in different ways.

<br>

# Report bugs

Before reporting a bug, please check our [the issues on our GitHub repository](https://github.com/HeyPuter/puter/issues) to see if the bug has already been reported. If it has, you can add a comment to the existing issue with any additional information you have.

If you find a new bug in Puter, please [open an issue on our GitHub repository](https://github.com/HeyPuter/puter/issues/new). We'll do our best to address the issue as soon as possible. When reporting a bug, please include as much information as possible, including:

- A clear and descriptive title
- A description of the issue
- Steps to reproduce the bug
- Expected behavior
- Actual behavior
- Screenshots, if applicable
- Your host operating system and browser
- Your Puter version, location, ...

Please open a separate issue for each bug you find.

Maintainers will apply the appropriate labels to your issue.

<br>

# Suggest new features

If you have an idea for a new feature in Puter, please open a new discussion thread on our [GitHub repository](https://github.com/HeyPuter/puter/discussions) to discuss your idea with the community. We'll do our best to respond to your suggestion as soon as possible.

When suggesting a new feature, please include as much information as possible, including:

- A clear and descriptive title
- A description of the feature
- The problem the feature will solve
- Any relevant screenshots or mockups
- Any relevant links or resources

<br>

# Contribute code

If you'd like to contribute code to Puter, you need to fork the project and submit a pull request. If this is your first time contributing to an open-source project, we recommend reading this short guide by GitHub on [how to contribute to a project](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project).

We'll review your pull request and work with you to get your changes merged into the project.

## Repository Structure

![file structure](./doc/File%20Structure.drawio.png)

## Your first code contribution

We maintain a list of issues that are good for first-time contributors. You can find these issues by searching for the [`good first issue`](https://github.com/HeyPuter/puter/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label in our [GitHub repository](https://github.com/HeyPuter/puter). These issues are designed to be relatively easy to fix, and we're happy to help you get started. Pick an issue that interests you, and leave a comment on the issue to let us know you're working on it.

## Documentation for Contributors

### Backend
See [src/backend/CONTRIBUTING.md](src/backend/CONTRIBUTING.md)

<br>

## PR Standards

We expect the following from pull requests (it makes things easier):
- If you're closing an issue, please reference that issue in the PR description
- Avoid whitespace changes
- No regressions for "appspace" (Puter apps)

<br>

## Commit Messages

**Note:** we will squash-merge some PRs so they follow . Large PRs should follow conventional commits also. The instructions below are outdated but suitable for most PRs.

### Conventional Commits
We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) with the following prefixes:
- `fix:` for bug fixes
- `dev:` instead of `refactor:`; covers more basis
- `tweak:` for small updates
- `sync:` when updating data from another source
- `feat:` for a commit that first introduces a new feature

Commit messages after the prefix should use the imperative (the same convention used in the repo for Linux, which Git was built for):

- correct: `dev: improve performance of readdir`
- incorrect: `dev: improved readdir`
- incorrect: `dev: improving readdir`

We have the following exceptions to this rule:
- If the commit message is in _past tense_, it's a shorthand for the following:
  - `dev: apply changes that would be applied after one had <past tense message>`
- If the commit message is in _present tense_, it's shorthand for the following:
  - `dev: apply changes that would be applied after <present-tense message>`

For example, the following are correct:
- `dev: improved readdir`
  - interpret this as: `dev: apply changes that would be applied after one had improved readdir`
- `dev: improving readdir`
  - interpret this as: `dev: apply changes that would be applied after improving readdir`

<br>

## Code Review

Once you've submitted your pull request, the project maintainers will review your changes. We may suggest some changes or improvements. This is a normal part of the process, and your contributions are greatly appreciated!

<br>

## Contribution License Agreement (CLA)

Like many open source projects, we require contributors to sign a Contribution License Agreement (CLA) before we can accept your code. When you open a pull request for the first time, a bot will automatically add a comment with a link to the CLA. You can sign the CLA electronically by following the link and filling out the form.

<br>

# Getting Help

If you have any questions about Puter, please feel free to reach out to us through the following channels:

- [Discord](https://discord.com/invite/PQcx7Teh8u)
- [Reddit](https://www.reddit.com/r/Puter/)
- [Twitter](https://twitter.com/HeyPuter)
- [Email](mailto:support@puter.com)
