import fs from 'node:fs';
import { optimize } from 'svgo';
import { slugify } from 'transliteration';

import * as utils from './utils.js';

export default class IconsSync {
    md5 = utils.md5;
    request = utils.sendRequest;
    performMigrations = utils.performMigrations;

    warn = utils.warn;
    report = utils.printToConsole;
    visualiseChangelog = utils.visualiseChangelog;

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
     * @param {bool} forceReload 
     * @returns sync status, including changelog, number of fetches and report
     */
    async extractIcons(forceReload = false) {
        // Check if an icon exists on filesystem. Returns false when force re-fetch is requested
        const exists = async (icon) => !forceReload && fs.existsSync(this.outputDirectory + icon.name + '.svg');

        // Returns the contents of the icon
        const getContents = async (filename) => {
            const fullPath = this.outputDirectory + filename + '.svg';
            if(fs.existsSync(fullPath)) {
                return fs.readFileSync(fullPath, { encoding: 'utf8' });
            }

            return false;
        };

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

        // Downloading new & updated icons
        if(downloadList.length > 0) {
            this.report(`Downloading icons, ${downloadList.length} total...`, true);
            const iconsSVGs = await this.downloadAndCleanIcons(downloadList);
            iconsContents.push(...iconsSVGs);
        }

        // Processing changes and renames
        for(let iconID in iconsContents) {
            const icon = iconsContents[iconID];
            const type = Object.keys(changelog).find(
                (key) => changelog[key].find(({ nodeId }) => nodeId === icon.nodeId) != undefined
            );

            switch(type) {
                case 'added':
                    // If an icon conflicts with an existing icon on the filesystem and their contents differ, reporting the conflict 
                    if(await exists(icon) && await getContents(icon.name) != icon.svg) {
                        delete iconsContents[iconID];
                        this.warn('unable-to-save', {
                            name: icon.name
                        });

                    // Otherwise saving an icon
                    } else {
                        this.saveIcon(icon);
                    }
                    break;
                
                default:
                    if(icon.isRenamed) {
                        const eventData = {
                            presentName: icon.name,
                            previousNames: icon.previousNames.filter(v => v !== icon.name)
                        };
                        
                        // If the icon's name reverted to the previous one, deleting new name from the list of previous names
                        if(icon.previousNames.includes(icon.name)) {
                            icon.previousNames = icon.previousNames.filter(v => v !== icon.name);
                            this.saveIcon(icon, true);
                            this.warn('renamed-saved-both', eventData);
                        
                        // Checking if able to write a new file
                        } else if(await exists(icon) && await getContents(icon.name) != icon.svg) {
                            // Reverting icon's name to the old one
                            icon.name = data.previousNames.slice(-1)[0];
                            // Reporting about the situation
                            this.warn('renamed-unable-to-save', eventData);
                            
                        // If icon does not exist
                        } else {
                            // Saving both old and new icons
                            this.saveIcon(icon, true);
                            this.warn('renamed-saved-both', eventData);
                        }
        
                    // If the icon was modified in any way, save it under its current and all previous names
                    } else {
                        // Checking & filtering the previous names
                        icon.previousNames = icon.previousNames.filter((name) => 
                            name !== icon.name && fs.existsSync(this.outputDirectory + name + '.svg')
                        );

                        // Reminding to remove usages of the old names from codebase
                        if(icon.previousNames.length > 0) {
                            this.warn('rename-reminder', {
                                previousNames: icon.previousNames,
                                presentName: icon.name
                            });
                        }

                        // Saving changes when the icon was modified
                        if(type != 'unmodified') {
                            this.saveIcon(icon, true);
                        }
                    }
                    break;
            }
        }

        this.updateLocalIconsDb(iconsContents.filter(icon => icon != null).map(icon => {
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
                .filter((icon) => fs.existsSync(this.outputDirectory + icon.name + '.svg'))
            );
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
     * Saves an icon to the filesystem
     * @param {icon} icon 
     * @param {bool} saveUnderPreviousNames 
     */
    saveIcon(icon, saveUnderPreviousNames = false) {
        const namesList = [icon.name];

        if(saveUnderPreviousNames === true) {
            namesList.push(...icon.previousNames);
        }

        for(const name of namesList) {
            const iconPath = name.split('/');
        
            let iconName = iconPath.pop() + '.svg';
            let targetDir = this.outputDirectory + (iconPath.length > 0 ? iconPath.join('/') + '/' : '');

            if(this.ignoreSubfolders) {
                iconName = name.split('/').join('_') + '.svg';
                targetDir = this.outputDirectory;
            }

            // Making sure the target path exists
            if(!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Writing the icon
            fs.writeFileSync(targetDir + iconName, icon.svg);
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
            const pushData = (vector) => {
                vectorData.push([
                    vector.fillGeometry, 
                    vector.fills,
                    vector.strokes, 
                    vector.strokeWeight,
                    vector.strokeAlign,
                    vector.strokeGeometry,
                    vector.strokeCap,
                    vector.constraints,
                    vector.effects,
                    'clipsContent' in vector ? vector.clipsContent : ''
                ]);
            };

            // Including component's props into hash
            if(recursively === false) {
                pushData(contents);
            }

            for (const child of contents.children) {
                // Includes children props into hash 
                if('fillGeometry' in child || 'strokes' in child) {
                    pushData(child);
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
            if(frame.visible === false) return;

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
            const cleanedSvg = optimize(svg, this.svgoConfig).data;
            icon.svg = cleanedSvg;

            cleanedIcons.push(icon);
        }

        return cleanedIcons;
    }
}
