import fs from 'node:fs';
import { createHash } from 'node:crypto';
import colors from 'colors';

/**
 * Calculates MD5 Hash for vector object contents
 * @param {string} string
 */
export function md5(string) {
    return createHash('md5').update(string).digest('hex');
};

/**
 * Provides console output for CLI mode
 * @param {string} text
 * @param {boolean} replaceLine    Replaces current line and appends the carriage return at the EOL 
*/
export function printToConsole(text, replaceLine = false) {
    if(this.cli.enabled !== true) { return; }
    if(this.cli.quiet === true) { return; }

    if(replaceLine === true) {
        process.stdout.clearLine(0);
        process.stdout.write(text + '\r');
    } else {
        console.log(text);
    }
}

/**
 * Sends HTTP Requests
 * @param {string} endpoint        Endpoint
 * @param {boolean} unpackJson     Parse response with JSON.decode and return as object
 * @param {boolean} useAuth        Send Figma Auth header
 */
export function sendRequest(endpoint, unpackJson = true, useAuth = true) {
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

/**
 * Extracts file ID and frame ID from figma link
 * @param {string} url  URL to Figma frame containing icons
 */
export function extractFileIdsFromUrl(url) {
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

/**
 * Checks requirements before running the logic
 */
export function checkRequirements() {
    if(process.version.match(/^v(\d+\.\d+)/)[1] < 18) {
        throw new Error('Node.js 18.0+ is required. Currently running on version ' + process.version);
    }
}

/**
 * Performs migrations when upgrading to a newer package version
 */
export async function performMigrations() {
    // Migration to 1.1.0
    const deprecatedHashesFile = this.outputDirectory + '_icons.js';
    if(fs.existsSync(deprecatedHashesFile) && fs.existsSync(this.localHashesFile) === false) {
        const contents = await fs.readFileSync(deprecatedHashesFile, { encoding: 'utf8' });
        try {
            const icons = JSON.parse(contents);
            await fs.writeFileSync(this.localHashesFile, JSON.stringify(icons));
            fs.unlinkSync(deprecatedHashesFile);
        } catch(err) {
            this.report('Unable to perform migration to 1.1.0: _icons.js is damaged');
        }
    }
}

/**
 * Contains pre-defined warnings and messages
 */
export function warn(event, data) {
    const listFilenames = (any) => {
        return (typeof any === 'object' && any instanceof Array ? any : [ any ]).map(v => v + '.svg');
    };

    const events = {
        'renamed-unable-to-save': {
            type: 'error',
            badges: [
                'WARNING'.bgYellow.black,
                'UNABLE TO SAVE'.bgYellow.black
            ],
            message: [
                'The icon was renamed, but the file with target name already exists.',
                'Former names:\t'.gray + listFilenames(data.previousNames).join(', '), 
                'Present name:\t'.gray + data.presentName + '.svg',
            ],
            filenames: {
                former: listFilenames(data.previousNames),
                present: data.presentName + '.svg',
            }
        },
        'unable-to-save': {
            type: 'error',
            badges: [
                'WARNING'.bgYellow.black,
                'UNABLE TO SAVE'.bgYellow.black
            ],
            message: [
                `The icon named '${data.name}.svg' already exists.`
            ],
            filenames: {
                present: data.name + '.svg',
            }
        },
        'renamed-saved-both': {
            type: 'warning',
            badges: [
                'WARNING'.bgYellow.black,
            ],
            message: [
                'The icon has been renamed. Both files have been saved, and no urgent action is required. Please update the icon\'s name in your codebase and then delete the old-named icon.',
                'Former names:\t'.gray + listFilenames(data.previousNames).join(', '), 
                'Present name:\t'.gray + data.presentName + '.svg',
            ],
            filenames: {
                former: listFilenames(data.previousNames),
                present: data.presentName + '.svg',
            }
        },
        'rename-reminder': {
            type: 'reminder',
            badges: [
                'REMINDER'.bgWhite.black,
            ],
            message: [
                'Rename the icon in your codebase to match the new name and delete the old icon.',
                'Former names:\t'.gray + listFilenames(data.previousNames).join(', '), 
                'Present name:\t'.gray + data.presentName + '.svg',
            ],
            filenames: {
                former: listFilenames(data.previousNames),
                present: data.presentName + '.svg',
            }
        },
    };

    if(event in events) {
        const data = events[event];
        this.eventsList.push({
            event: event,
            description: data.message[0],
            filenames: data.filenames
        });

        this.report('', true);
        this.report(
            data.badges.join(' ') + 
            '\n' + 
            data.message.join('\n')
        );
    }
}

/**
 * Displays the human-readable changelog in the console
 * @param {*} result 
 * @returns 
 */
export function visualiseChangelog(result) {
    if(this.cli.enabled !== true) { return; }

    const changelog = result.changelog;
    const totalFetches = result.totalFetches;

    this.report('', true);
    
    console.group('Changelog:');
    this.report(`Unmodified: \t${changelog.unmodified.length}`);
    this.report(`Modified: \t${changelog.modified.length}`.yellow);
    this.report(`Added: \t${changelog.added.length}`.green);
    this.report(`Restored: \t${changelog.restored.length}`.blue);
    this.report(
        (
            `Removed: \t${changelog.removed.length}` +
            (changelog.removed.length > 0 ? ' (' + changelog.removed.join(', ') + ')' : '')
        ).magenta
    );
    console.groupEnd();

    if(totalFetches === 0) {
        this.report('✓ All icons are up-to-date.');
    }
};

/**
 * Default settings for SVGo optimisation
 */
export const _defaultSVGoSettings = {
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