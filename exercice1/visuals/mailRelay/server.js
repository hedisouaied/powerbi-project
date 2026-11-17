'use strict';

/*
 * Local mail relay for the Mauve Sales Page visual.
 * A Power BI visual runs in a browser sandbox and can't speak SMTP, and a password stored in it could be
 * read by anyone holding the report. So the visual posts the email here, and this service sends it.
 * It listens on this PC only, requires a token, and only ever sends to the MAIL_TO address in .env.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const nodemailer = require('nodemailer');

const PORT = 8787;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function loadEnv() {
    const file = path.join(__dirname, '.env');
    const values = {};
    if (fs.existsSync(file)) {
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
            const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
            if (match) {
                values[match[1]] = match[2];
            }
        });
    }
    // Real environment variables win, which allows a dry run: MAIL_MAILER=log.
    Object.keys(process.env).filter(key => /^(MAIL|RELAY)_/.test(key)).forEach(key => { values[key] = process.env[key]; });
    return values;
}

const config = loadEnv();
const isDryRun = config.MAIL_MAILER === 'log';
const logDir = config.MAIL_LOG_DIR || path.join(__dirname, 'sent-log');

function isConfigured() {
    return Boolean(isDryRun || (config.MAIL_HOST && config.MAIL_USERNAME && config.MAIL_PASSWORD)) && Boolean(config.MAIL_TO);
}

function createTransport() {
    if (isDryRun) {
        return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    }
    return nodemailer.createTransport({
        host: config.MAIL_HOST,
        port: Number(config.MAIL_PORT) || 587,
        secure: config.MAIL_ENCRYPTION === 'ssl',
        requireTLS: config.MAIL_ENCRYPTION === 'tls',
        auth: { user: config.MAIL_USERNAME, pass: config.MAIL_PASSWORD }
    });
}

function tokenIsValid(request) {
    const expected = Buffer.from(config.RELAY_TOKEN || '');
    const received = Buffer.from(String(request.headers['x-relay-token'] || ''));
    return expected.length > 0 && expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function reply(response, status, body) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Private-Network': 'true'
    });
    response.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Email is too large.'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

function describeSmtpError(error) {
    if (error.code === 'EAUTH') {
        return 'Gmail rejected the login. Check MAIL_USERNAME and MAIL_PASSWORD (it must be an app password) in visuals\\mailRelay\\.env.';
    }
    if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(error.code)) {
        return `Could not reach ${config.MAIL_HOST}:${config.MAIL_PORT}. Check the internet connection or firewall.`;
    }
    return `Sending failed: ${error.message}`;
}

async function send(payload) {
    const message = {
        from: { name: config.MAIL_FROM_NAME || 'Sales Overview', address: config.MAIL_USERNAME },
        to: config.MAIL_TO,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: (payload.images || []).map(image => ({
            filename: `${image.cid}.png`,
            content: Buffer.from(image.base64, 'base64'),
            contentType: 'image/png',
            cid: image.cid
        }))
    };
    const info = await createTransport().sendMail(message);
    if (isDryRun) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, 'last-email.eml'), info.message);
    }
    return config.MAIL_TO;
}

/**
 * On first start, asks for the Gmail app password in this window and saves it to .env.
 */
function askForPassword() {
    return new Promise(resolve => {
        if (isDryRun || config.MAIL_PASSWORD) {
            resolve();
            return;
        }
        const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
        let answered = false;
        prompt.question('Paste the Gmail app password of ' + config.MAIL_USERNAME + ', then press Enter: ', answer => {
            answered = true;
            prompt.close();
            const password = answer.replace(/\s/g, '');
            if (password) {
                const file = path.join(__dirname, '.env');
                fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^MAIL_PASSWORD=.*$/m, `MAIL_PASSWORD=${password}`));
                config.MAIL_PASSWORD = password;
                console.log('Password saved to .env.');
            }
            resolve();
        });
        prompt.on('close', () => {
            if (!answered) {
                resolve();
            }
        });
    });
}

const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
        reply(response, 204);
        return;
    }
    if (!tokenIsValid(request)) {
        reply(response, 401, { ok: false, error: 'The visual and the mail service have different tokens.' });
        return;
    }
    if (request.method === 'GET' && request.url === '/health') {
        reply(response, 200, { ok: true, configured: isConfigured(), to: config.MAIL_TO, dryRun: isDryRun });
        return;
    }
    if (request.method === 'POST' && request.url === '/send') {
        if (!isConfigured()) {
            reply(response, 400, { ok: false, error: 'Add MAIL_PASSWORD to visuals\\mailRelay\\.env, then restart the mail service.' });
            return;
        }
        try {
            const payload = JSON.parse(await readBody(request));
            if (typeof payload.subject !== 'string' || typeof payload.html !== 'string') {
                reply(response, 400, { ok: false, error: 'The email has no subject or body.' });
                return;
            }
            const to = await send(payload);
            console.log(`${new Date().toISOString()} sent "${payload.subject}" to ${to}${isDryRun ? ' (dry run)' : ''}`);
            reply(response, 200, { ok: true, to });
        } catch (error) {
            console.error(`${new Date().toISOString()} failed: ${error.message}`);
            reply(response, 502, { ok: false, error: describeSmtpError(error) });
        }
        return;
    }
    reply(response, 404, { ok: false, error: 'Not found.' });
});

askForPassword().then(() => {
    server.listen(PORT, '127.0.0.1', () => {
        console.log(`Mail service ready on http://127.0.0.1:${PORT} - emails go to ${config.MAIL_TO || '(MAIL_TO missing)'}${isDryRun ? ' - DRY RUN, nothing is sent' : ''}`);
        if (!isConfigured()) {
            console.log('Not configured yet: no Gmail app password. Close this window and run it again.');
        }
        console.log('Keep this window open while using the Send by email button.');
    });
});
