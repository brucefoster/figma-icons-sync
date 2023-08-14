const { createHash } = require('node:crypto');

/**
 * Calculates MD5 Hash for vector object contents
 * @param {string} string
 */
function md5(string) {
    return createHash('md5').update(string).digest('hex');
};

exports.md5 = md5;

/**
 * Provides console output for CLI mode
 * @param {string} text
 * @param {boolean} replaceLine    Replaces current line and appends the carriage return at the EOL 
*/
function printToConsole(text, replaceLine = false) {
    if(this.cli.enabled !== true) { return; }
    if(this.cli.quiet === true) { return; }

    if(replaceLine === true) {
        process.stdout.clearLine(0);
        process.stdout.write(text + '\r');
    } else {
        console.log(text);
    }
}

exports.printToConsole = printToConsole;

/**
 * Sends HTTP Requests
 * @param {string} endpoint        Endpoint
 * @param {boolean} unpackJson     Parse response with JSON.decode and return as object
 * @param {boolean} useAuth        Send Figma Auth header
 */
function sendRequest(endpoint, unpackJson = true, useAuth = true) {
    const headers = {
        'X-Figma-Token': this.token,
    };

    const options = {
        method: 'GET',
        headers: useAuth ? headers : [],
    };

    return fetch(endpoint, options)
        .then((response) => {
            if(!response.ok) {
                throw new Error(`Unable to reach ${endpoint}, status ${response.status}`);
            }

            return unpackJson ? response.json() : response.text();
        });
}

exports.sendRequest = sendRequest;

/**
 * Extracts file ID and frame ID from figma link
 * @param {string} url  URL to Figma frame containing icons
 */
function extractFileIdsFromUrl(url) {
    const extractIdsRegex = /www\.figma\.com\/file\/([\w\d]+)\/.+(?:\?|\&)node-id=([\d\-]+)/m;
    const matches = url.match(extractIdsRegex);

    if(matches === null || matches.length !== 3) {
        throw new Error('Wrong Figma file URL: provide a link directly to a frame');
    }

    return {
        fileId: matches[1],
        nodeId: matches[2],
    };
}

exports.extractIds = extractFileIdsFromUrl;

/**
 * Default settings for SVGo optimisation
 */
const _defaultSVGoSettings = {
    multipass: true,
    plugins: ([
        {
            name: 'preset-default',
            params: {
                overrides: {
                    removeViewBox: false,
                },
            },
        },
    ]),
};

exports._defaultSVGoSettings = _defaultSVGoSettings;