const fs = require('node:fs');
const { optimize } = require('svgo');
const { slugify } = require('transliteration');
const colors = require('colors');

const {
    md5,
    printToConsole,
    sendRequest
} = require('./utils');

class IconsSync {
    md5 = md5;
    report = printToConsole;
    request = sendRequest;

    constructor(options) {
        for(const key of Object.keys(options)) {
            this[key] = options[key];
        }
        
        this.endpointBase = 'https://api.figma.com/v1';
        this.localHashesFile = this.outputDirectory + '_icons.js';
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
                        child.strokeCap
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
                    name: slugify(frame.name.toLowerCase().replace(/\s/g, '-'), slugifyConfig),
                    nodeId: frame.id,
                    hash: calcIconHash(frame),
                });
            } else if(frame.type === 'COMPONENT_SET') {
                // Set of components was found: typically it's just variations of a single icon packed in one component.
                // Appending a prefix of the set's name and transliterating non-latin chars

                const componentSetName = slugify(frame.name.toLowerCase().replace(/\s/g, '-'), slugifyConfig);
                const children = this.findComponentsRecursively(frame.children);

                output.push(...children.map((value) => ({
                    name: `${componentSetName}__${slugify(value.name.toLowerCase().replace(/=/g, '_'), slugifyConfig)}`,
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
            const cleanedSvg = optimize(svg, this.svgoConfig).data;

            cleanedIcons.push({
                name: icon.name,
                svg: cleanedSvg,
            });
        }

        this.report('', true);
        return cleanedIcons;
    }
}

module.exports = IconsSync;
