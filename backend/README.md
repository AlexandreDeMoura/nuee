<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Configuration

The backend validates its environment before constructing application
providers. Tests bind the deterministic `ModelClient` fake; every non-test
environment binds the OpenAI Responses API client and therefore requires
`OPENAI_API_KEY`.

| Variable                              | Default                          | Purpose                                                                              |
| ------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                            | `development`                    | `development`, `test`, or `production`                                               |
| `PORT`                                | `3000`                           | Backend HTTP port                                                                    |
| `FRONTEND_URL`                        | `http://localhost:5173`          | Exact HTTP(S) origin allowed by CORS                                                 |
| `PROJECT_DATABASE_PATH`               | `backend/data/nuee.sqlite`       | SQLite file path; `:memory:` is supported by tests                                   |
| `AI_PROVIDER`                         | `openai`                         | AI provider; OpenAI is the only supported value                                      |
| `AI_MODEL`                            | `gpt-5.6-sol`                    | OpenAI model ID sent to the Responses API                                            |
| `OPENAI_API_KEY`                      | none                             | Required outside `NODE_ENV=test`                                                     |
| `AI_WEB_SEARCH_ENABLED`               | `false`                          | Enables the provider-backed web-search capability when set to `true`                 |
| `AI_FOCUSED_RESPONSE_WORD_BUDGET`     | `200`                            | Soft prompt target for approximately one-minute answers; it does not truncate output |
| `AI_MODEL_INPUT_TOKEN_LIMIT`          | `128000`                         | Total model context window used by the conservative input preflight                  |
| `AI_RESERVED_OUTPUT_TOKENS`           | `4000`                           | Context-window capacity reserved for the next model response                         |
| `AI_INPUT_SAFETY_MARGIN_TOKENS`       | `8000`                           | Additional capacity kept unused to absorb estimation and provider overhead           |
| `AI_REQUEST_TIMEOUT_MS`               | `60000`                          | Per-attempt OpenAI SDK timeout                                                       |
| `DOCUMENT_PRIVATE_STORAGE_PATH`       | `backend/data/private-documents` | Private persistent root for original documents                                       |
| `DOCUMENT_MAX_FILE_SIZE_BYTES`        | `10485760`                       | Maximum original size per upload                                                     |
| `DOCUMENT_MAX_DOCUMENTS_PER_PROJECT`  | `25`                             | Maximum persisted documents per project                                              |
| `DOCUMENT_MAX_PROJECT_STORAGE_BYTES`  | `104857600`                      | Maximum original-file bytes per project                                              |
| `DOCUMENT_MAX_PDF_PAGES`              | `200`                            | PDF page limit; excess is rejected rather than truncated                             |
| `DOCUMENT_MAX_EXTRACTED_TEXT_BYTES`   | `16777216`                       | Maximum normalized processed-text size                                               |
| `DOCUMENT_PROCESSING_TIMEOUT_MS`      | `30000`                          | Deadline for one scan-and-extract attempt                                            |
| `DOCUMENT_PROCESSING_LEASE_MS`        | `45000`                          | Durable lease duration; must exceed the processing timeout                           |
| `DOCUMENT_PROCESSING_CONCURRENCY`     | `2`                              | Concurrent workers inside the single backend process                                 |
| `DOCUMENT_PROCESSING_MAX_ATTEMPTS`    | `3`                              | Automatic attempts before a recoverable failed state                                 |
| `DOCUMENT_MALWARE_SCANNER_HOST`       | `127.0.0.1`                      | Production ClamAV host                                                               |
| `DOCUMENT_MALWARE_SCANNER_PORT`       | `3310`                           | Production ClamAV TCP port                                                           |
| `DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS` | `10000`                          | Deadline for one ClamAV scan                                                         |

Production storage, ClamAV provisioning, lease recovery, cleanup, backup/restore, HTTPS, and the
trusted single-user authentication boundary are specified in
[DOCUMENT_OPERATIONS.md](DOCUMENT_OPERATIONS.md).

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
