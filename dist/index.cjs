'use strict';

var fs = require('node:fs');
var node_crypto = require('node:crypto');
require('colors');
var svgo = require('svgo');
var transliteration = require('transliteration');

/**
 * Calculates MD5 Hash for vector object contents
 * @param {string} string
 */
function md5(string) {
    return node_crypto.createHash('md5').update(string).digest('hex');
}
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

/**
 * Checks requirements before running the logic
 */
function checkRequirements() {
    if(process.version.match(/^v(\d+\.\d+)/)[1] < 18) {
        throw new Error('Node.js 18.0+ is required. Currently running on version ' + process.version);
    }
}

/**
 * Performs migrations when upgrading to a newer package version
 */
async function performMigrations() {
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
function warn(event, data) {
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
function visualiseChangelog(result) {
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
}
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

class IconsSync {
    md5 = md5;
    report = printToConsole;
    request = sendRequest;
    performMigrations = performMigrations;
    warn = warn;
    visualiseChangelog = visualiseChangelog;

    eventsList = [];

    constructor(options) {
        for(const key of Object.keys(options)) {
            this[key] = options[key];
        }
        
        this.endpointBase = 'https://api.figma.com/v1';
        this.localHashesFile = this.outputDirectory + '_icons.json';
    }

    /**
     * Primary logic: fetching, comparing to local, updating & downloading
    */
    async extractIcons(forceReload = false) {
        await this.performMigrations();
        this.report('Scanning the Figma file for the icons...', true);

        // Connecting to Figma, looking for components
        const frameContents = await this.getFigmaFrameContents();
        const iconsList = this.findComponentsRecursively(frameContents);

        // Comparing changes with local folder
        const changelog = await this.consolidateChanges(iconsList, forceReload);

        // Building the list of icons to download
        const downloadList = [
            ...changelog.added, 
            ...changelog.modified, 
            ...changelog.restored
        ];

        // Building the list of unmodified icons
        const iconsContents = [
            ...changelog.unmodified, 
            ...changelog.removed
        ].map(icon => {
            const names = [...icon.previousNames, icon.name];
            for(const name of names) {
                if(fs.existsSync(this.outputDirectory + name + '.svg')) {
                    icon.svg = fs.readFileSync(this.outputDirectory + name + '.svg');
                }
            }
            return icon;
        });

        /**
         * Saves an icon to filesystem
         * @param {*} icon 
         * @param {*} saveUnderPreviousNames 
         */
        const save = (icon, saveUnderPreviousNames = false) => {
            const namesList = [icon.name];

            if(saveUnderPreviousNames === true) {
                namesList.push(...icon.previousNames);
            }

            for(const name of namesList) {
                if(name == null) continue;
                
                const iconPath = name.split('/');
            
                let iconName = iconPath.pop() + '.svg';
                let targetDir = this.outputDirectory + (iconPath.length > 0 ? iconPath.join('/') + '/' : '');

                if(this.ignoreSubfolders) {
                    iconName = name.split('/').join('_') + '.svg';
                    targetDir = this.outputDirectory;
                }

                // Making sure target path exists
                if(!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // Writing icon
                fs.writeFileSync(targetDir + iconName, icon.svg);
            }
        };

        /**
         * Check if an icon exists on filesystem.
         * Returns false when force re-fetch is requested
         * @param {*} icon 
         * @returns 
         */
        const exists = async (icon) => {
            return !forceReload && fs.existsSync(this.outputDirectory + icon.name + '.svg');
        };

        /**
         * Returns the modification type of an icon
         * @param {*} icon 
         * @returns 
         */
        const getType = (icon) => {
            return Object.keys(changelog).find((key) => changelog[key].find(({ nodeId }) => nodeId === icon.nodeId) != undefined)
        };

        // Downloading new & updated icons
        if(downloadList.length > 0) {
            this.report(`Downloading icons, ${downloadList.length} total...`, true);
            const iconsSVGs = await this.downloadAndCleanIcons(downloadList);
            iconsContents.push(...iconsSVGs);
        }

        // Processing changes and renames
        for(let iconID in iconsContents) {
            const icon = iconsContents[iconID];
            const type = getType(icon);

            // If icon was renamed, saving icon both under old and new names
            if(icon.isRenamed) {
                const data = {
                    presentName: icon.name,
                    previousNames: icon.previousNames.filter(v => v !== icon.name)
                };
                
                // If the icon's name reverted to the previous one, new name should be deleted from the list of previous names
                if(icon.previousNames.includes(icon.name)) {
                    icon.previousNames = icon.previousNames.filter(v => v !== icon.name);
                    save(icon, true);
                    this.warn('renamed-saved-both', data);
                
                // Checking if able to write a new file
                } else if(await exists(icon)) {
                    // Reverting icon's name to the old one
                    icon.name = data.previousNames.slice(-1)[0];
                    // Reporting about the situation
                    this.warn('renamed-unable-to-save', data);
                    
                // If icon does not exist
                } else {
                    // Saving both old and new icons
                    save(icon, true);
                    this.warn('renamed-saved-both', data);
                }

            // If a new icon is detected, attempt to save it or provide a warning if a conflict arises
            } else if(type == 'added') {
                const data = {
                    name: icon.name
                };

                if(await exists(icon)) {
                    delete iconsContents[iconID];
                    this.warn('unable-to-save', data);
                } else {
                    save(icon);
                }

            // If the icon was modified in any way, save it under its current and all previous names
            } else {
                // Checking & filtering the previous names
                icon.previousNames = icon.previousNames.filter((name) => 
                    name !== icon.name && fs.existsSync(this.outputDirectory + name + '.svg')
                );

                // Reminding to remove usages of the old names from codebase
                if(icon.previousNames.length > 0) {
                    const data = {
                        previousNames: icon.previousNames,
                        presentName: icon.name
                    };

                    this.warn('rename-reminder', data);
                }

                // Saving changes when the icon was modified
                if(type != 'unmodified') {
                    save(icon, true);
                }
            }
        }

        this.updateLocalIconsDb(iconsContents.map(icon => {
            // Minifying local database by removing icon contents and non-required params
            delete icon.svg;
            delete icon.isRenamed;

            return icon;
        }));

        // Returns changelog without superfluous data
        const output = {
            changelog: Object.keys(changelog).reduce((acc, key) => { 
                acc[key] = changelog[key].map((icon) => icon.name + '.svg'); 
                return acc; 
            }, {}),
            totalFetches: downloadList.length,
            reports: this.eventsList
        };


        this.visualiseChangelog(output);
        return output;
    }

    /**
     * Compares local and remote icons for changes, additions and deletions 
    */
    async consolidateChanges(remoteIcons, force = false) {
        const changelog = {
            unmodified: [],
            modified: [],
            added: [],
            restored: [],
            removed: [],
        };

        const format = (icon) => {
            return {
                nodeId: icon.nodeId,
                name: icon.name,
                previousNames: 'previousNames' in icon ? icon.previousNames : [],
                isRenamed: false,
                hash: icon.hash
            };
        };

        remoteIcons = remoteIcons.map(icon => format(icon));

        if(fs.existsSync(this.localHashesFile) && force !== true) {
            const localIcons = await JSON.parse(
                fs.readFileSync(this.localHashesFile, { encoding: 'utf8' })
            ).map(icon => format(icon));

            for (const remoteIcon of remoteIcons) {
                const localIcon = localIcons.find(({ nodeId }) => nodeId === remoteIcon.nodeId);

                // This is a new icon
                if(localIcon === undefined) {
                    changelog.added.push(remoteIcon);
                
                // This icon exists or has existed
                } else {
                    // Preserving previous names
                    remoteIcon.previousNames = localIcon.previousNames;

                    // Checking if name has changed
                    if(localIcon.name != remoteIcon.name) {
                        // If the icon's old name is not already in the list of previous names, then add it
                        if(remoteIcon.previousNames.includes(localIcon.name) === false) {
                            remoteIcon.previousNames.push(localIcon.name);
                        }
                        remoteIcon.isRenamed = true;
                    }

                    // The hashes matched, no changes in the remote icon
                    if(remoteIcon.hash === localIcon.hash) {
                        // Checking if icon exists
                        if(fs.existsSync(this.outputDirectory + localIcon.name + '.svg')) {
                            changelog.unmodified.push(remoteIcon);

                        // Icon does not exist
                        } else {
                            changelog.restored.push(remoteIcon);
                        }

                    // Hashes don't match: the icon has changed
                    } else if(remoteIcon.hash !== localIcon.hash) {
                        // Checking if icon exists
                        if(fs.existsSync(this.outputDirectory + localIcon.name + '.svg')) {
                            changelog.modified.push(remoteIcon);

                        // Icon does not exist
                        } else {
                            changelog.restored.push(remoteIcon);
                        }
                    }
                }
            }
            
            // Detecting removed icons & filtering those non-existing on the filesystem
            changelog.removed.push(...localIcons
                .filter((icon) => remoteIcons.find(({ nodeId }) => nodeId === icon.nodeId) === undefined)
                .filter((icon) => fs.existsSync(this.outputDirectory + icon.name + '.svg')));
        } else {
            changelog.added.push(...remoteIcons);
        }

        return changelog;
    }

    /**
     * Saves the JSON file with the list of local icons and their hashes
    */
    async updateLocalIconsDb(iconsList) {
        await fs.writeFileSync(this.localHashesFile, JSON.stringify(iconsList));
    }

    /**
     * Parses target frame structure
    */
    async getFigmaFrameContents() {
        const apiUrl = `${this.endpointBase}/files/${this.fileId}/nodes?ids=${this.nodeId}&geometry=paths`;

        const contents = await this.request(apiUrl);
        return contents.nodes[this.nodeId.replace(/-/g, ':')].document.children;
    }

    /**
     * Recursively finds icons on the frame or its children
     * @param {array[]} structure   Array of frame elements
    */
    findComponentsRecursively(frameContents) {
        const output = [];

        const calcIconHash = (contents, recursively = false) => {
            const vectorData = [];

            for (const child of contents.children) {
                // Includes data of fill & stroke into hash 
                if('fillGeometry' in child || 'strokes' in child) {
                    vectorData.push([
                        child.fillGeometry, 
                        child.fills,
                        child.strokes, 
                        child.strokeWeight,
                        child.strokeAlign,
                        child.strokeGeometry,
                        child.strokeCap,
                        child.constraints,
                        child.effects
                    ]);
                } 
                
                if('children' in child) {
                    vectorData.push(...calcIconHash(child, true));
                }
            }

            const hash = this.md5(JSON.stringify(vectorData));
            return recursively === true ? vectorData : hash;
        };

        const slugifyConfig = {
            ignore: ['/']
        };
        frameContents.forEach((frame) => {
            if(frame.type === 'COMPONENT') {
                // Single icon was found

                output.push({
                    name: transliteration.slugify(frame.name.toLowerCase().replace(/\s/g, '-'), slugifyConfig),
                    nodeId: frame.id,
                    hash: calcIconHash(frame),
                });
            } else if(frame.type === 'COMPONENT_SET') {
                // Set of components was found: typically it's just variations of a single icon packed in one component.
                // Appending a prefix of the set's name and transliterating non-latin chars

                const componentSetName = transliteration.slugify(frame.name.toLowerCase().replace(/\s/g, '-'), slugifyConfig);
                const children = this.findComponentsRecursively(frame.children);

                output.push(...children.map((value) => ({
                    name: `${componentSetName}__${transliteration.slugify(value.name.toLowerCase().replace(/=/g, '_'), slugifyConfig)}`,
                    nodeId: value.nodeId,
                    hash: value.hash,
                })));
            } else if(frame.children) {
                // Components are stored at the lowest level, so if the frame has children, skipping right to children

                output.push(...this.findComponentsRecursively(frame.children));
            }
        });

        return output;
    }

    /**
     * Downloads icons: first, sends a request to obtain download links for all icons in SVG,
     * then fetches one by one, cleans and optimizes with SVGo
    */
    async downloadAndCleanIcons(iconsList) {
        const iconsNodesList = iconsList.map((value) => value.nodeId);
        const apiUrl = `${this.endpointBase}/images/${this.fileId}?ids=${iconsNodesList.join(',')}&format=svg`;

        const response = await this.request(apiUrl);
        const iconsURLs = response.images;

        const cleanedIcons = [];

        for (const iconID in iconsList) {
            const icon = iconsList[iconID];
            this.report(`${iconID}/${iconsList.length}\tDownloading '${icon.name}'...`, true);
            let svg = await this.request(iconsURLs[icon.nodeId], false, false);

            // Checking whether an icon is monochromatic
            const listAllColorsRegex = /\s?(?:fill|stroke)=\"\#?([\d\w]+)(?<!none)\"/gm;
            const uniqueColors = [...svg.matchAll(listAllColorsRegex)]
                .map((el) => el[1])
                .filter((value, index, array) => array.indexOf(value) === index);

            // TODO: check for invisible frames
            const isMonochrome = uniqueColors.length <= 1 && this.monochrome.colors.includes(uniqueColors[0]);

            // If the icon is considered monochromatic, then remove fills & strokes (if set to true)
            if(isMonochrome) {
                if(this.monochrome.removeFill)
                    svg = svg.replace(/\s?fill=\"\#?([\d\w]+)(?<!none)\"/gm, '');

                if(this.monochrome.removeStroke)
                    svg = svg.replace(/\s?stroke=\"\#?([\d\w]+)(?<!none)\"/gm, '');
            }

            // Optimizing with SVGO
            const cleanedSvg = svgo.optimize(svg, this.svgoConfig).data;
            icon.svg = cleanedSvg;

            cleanedIcons.push(icon);
        }

        return cleanedIcons;
    }
}

const sync = async (figmaLink, config, forceReload = false) => {
    checkRequirements();

    if(typeof config !== 'object') {
        throw new Error('Config should be an object');
    }

    const conf = (key, strict = true, fallback = false) => {
        if(strict === true && key in config === false) {
            throw new Error(`Required key '${key}' is not present in the config`);
        }

        const keys = key.split('.');
        const value = keys.reduce((acc, k) => {
            return acc !== -Infinity && k in acc ? acc[k] : -Infinity; 
        }, config);

        return value !== -Infinity && (strict || typeof value === typeof fallback) ? value : fallback; 
        
    };

    const { fileId, nodeId } = extractFileIdsFromUrl(figmaLink);

    const outputDirectory = conf('output', false, './icons/');
    const options = {
        token: conf('apiToken'),
        outputDirectory: outputDirectory + (outputDirectory.endsWith('/') ? '' : '/'),
        ignoreSubfolders: conf('ignoreSubfolders', false, false),

        fileId: fileId,
        nodeId: nodeId,

        monochrome: {
            colors: conf('monochrome.colors', false, ['black', '000000']),
            removeFill: conf('monochrome.removeFill', false, false),
            removeStroke: conf('monochrome.removeStroke', false, false),
        },

        cli: {
            enabled: conf('enableConsoleOutput', false, false),
        },

        svgoConfig: conf('svgoConfig', false, _defaultSVGoSettings)
    };

    const syncer = new IconsSync(options);

    return new Promise(async (resolve, reject) => {
        try {
            resolve(await syncer.extractIcons(forceReload));
        } catch(err) {
            reject(err);
        }
    });
};

exports.sync = sync;
