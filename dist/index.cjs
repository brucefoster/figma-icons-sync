'use strict';

var node_crypto = require('node:crypto');
var fs = require('node:fs');
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
        this.report('Scanning the Figma file for the icons...', true);

        // Connecting to Figma, looking for components
        const frameContents = await this.getFigmaFrameContents();
        const iconsList = this.findComponentsRecursively(frameContents);

        // Comparing changes with local folder
        const changelog = await this.compareChanges(iconsList, forceReload);
        const downloadList = [...changelog.added, ...changelog.modified];

        // Downloading new & updated icons or reporting about no changes
        if(downloadList.length === 0) {
            this.report('✓ All icons are up-to-date.');
        } else {
            this.report(`Downloading icons, ${downloadList.length} total...`, true);
            const iconsSVGs = await this.downloadAndCleanIcons(downloadList);

            iconsSVGs.map((icon) => {
                const iconPath = icon.name.split('/');
                
                let iconName = iconPath.pop() + '.svg';
                let targetDir = this.outputDirectory + (iconPath.length > 0 ? iconPath.join('/') + '/' : '');

                if(this.ignoreSubfolders) {
                    iconName = icon.name + '.svg';
                    targetDir = this.outputDirectory;
                }

                // Making sure target path exists
                if(!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                // Writing icon
                fs.writeFileSync(targetDir + iconName, icon.svg);
            });

            this.updateLocalIconsHashes([...iconsList, ...changelog.removed]);
            this.report(`${downloadList.length} ${(downloadList.length % 10 == 1 ? 'icon was' : 'icons were')} updated.`.green, false);
        }

        return {
            changelog: Object.keys(changelog).reduce((acc, key) => { 
                acc[key] = changelog[key].map((icon) => icon.name + '.svg'); 
                return acc; 
            }, {}),
            totalFetches: downloadList.length
        };
    }

    /**
     * Compares local and remote icons for changes, additions and deletions 
    */
    async compareChanges(remoteIcons, force = false) {
        const changelog = {
            unmodified: [],
            modified: [],
            added: [],
            removed: [],
        };

        if(fs.existsSync(this.localHashesFile) && force !== true) {
            const localIcons = await JSON.parse(fs.readFileSync(this.localHashesFile, { encoding: 'utf8' }));

            for (const remoteIcon of remoteIcons) {
                const localIcon = localIcons.find(({ nodeId }) => nodeId === remoteIcon.nodeId);

                if(localIcon === undefined) {
                    // This is a new icon
                    changelog.added.push(remoteIcon);
                } else if(remoteIcon.hash === localIcon.hash) {
                    // The hashes matched, no changes in the remote icon
                    changelog.unmodified.push(remoteIcon);
                } else if(remoteIcon.hash !== localIcon.hash) {
                    // The hashes didn't match, the remote icon has changed
                    changelog.modified.push(remoteIcon);
                }
            }

            changelog.removed.push(...localIcons
                .filter((icon) => remoteIcons.find(({ nodeId }) => nodeId === icon.nodeId) === undefined));

            if(this.cli.enabled && this.cli.quiet === false) {
                this.report('', true);
                console.group('Changelog:');
                this.report(`Unmodified: \t${changelog.unmodified.length}`);
                this.report(`Modified: \t${changelog.modified.length}`.yellow);
                this.report(`Added: \t${changelog.added.length}`.green);
                this.report(
                    (
                        `Removed: \t${changelog.removed.length}` +
                        (changelog.removed.length > 0 ? ' (' + changelog.removed.map((value) => value.name + '.svg').join(', ') + ')' : '')
                    ).magenta
                );
                console.groupEnd();
            }
        } else {
            changelog.added.push(...remoteIcons);
        }

        return changelog;
    }

    /**
     * Saves the file with local icons hashes
    */
    async updateLocalIconsHashes(iconsList) {
        await fs.writeFileSync(this.localHashesFile, JSON.stringify(iconsList));
    }

    /**
     * Checks if the local icons have been deleted manually
    */
    async computeLocalChanges() {
        const existingIcons = [];

        if(fs.existsSync(this.localHashesFile)) {
            const localIcons = await JSON.parse(fs.readFileSync(this.localHashesFile, { encoding: 'utf8' }));
            await localIcons.map((icon) => fs.existsSync(this.outputDirectory + icon.name + '.svg') ? existingIcons.push(icon) : false);
            await this.updateLocalIconsHashes(existingIcons);
        }
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
                // Components are stored at the lowest level, so if the frame has children, skipping right to them

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

            cleanedIcons.push({
                name: icon.name,
                svg: cleanedSvg,
            });
        }

        this.report('', true);
        return cleanedIcons;
    }
}

const sync = async (figmaLink, config, forceReload = false) => {
    if(process.version.match(/^v(\d+\.\d+)/)[1] < 18) {
        throw new Error('Node.js 18.0+ is required. Currently running on version ' + process.version);
    }

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

    const options = {
        token: conf('apiToken'),
        outputDirectory: conf('output', false, './icons/'),
        ignoreSubfolders: conf('ignoreSubfolders', false, false),

        fileId: fileId,
        nodeId: nodeId,

        monochrome: {
            colors: conf('monochrome.colors', false, ['black', '000000']),
            removeFill: conf('monochrome.removeFill', false, false),
            removeStroke: conf('monochrome.removeStroke', false, false),
        },

        cli: {
            enabled: false,
        },

        svgoConfig: conf('svgoConfig', false, _defaultSVGoSettings)
    };

    const syncer = new IconsSync(options);

    return new Promise(async (resolve, reject) => {
        try {
            await syncer.computeLocalChanges();
            resolve(await syncer.extractIcons(forceReload));
        } catch(err) {
            reject(err);
        }
    });
};

exports.sync = sync;
