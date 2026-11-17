"use strict";

/**
 * Where the Send by email button posts. The token only works against the local mail service;
 * the SMTP password and the recipient live in that service's .env file, never in the report.
 */
// eslint-disable-next-line powerbi-visuals/no-http-string -- the mail service only listens on this PC.
export const MAIL_SERVICE_URL = "http://127.0.0.1:8787";
export const MAIL_SERVICE_TOKEN = "aae914fcaa6a3f02e080907d055969bdddb3d8dd1e59b336";
