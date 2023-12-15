#! /usr/bin/env node
import fs from 'node:fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PKG = JSON.parse(fs.readFileSync(__dirname + '/../package.json'));
import { program } from 'commander';
import colors from 'colors';
import { extractFileIdsFromUrl, _defaultSVGoSettings, checkRequirements } from './utils.js';
import FigmaSync from './sync.js';

checkRequirements();

program
    .name('icons-sync')
    .description(PKG.description)
    .version(PKG.version, '-v, --version')
    .arguments('[FIGMA-LINK]')
    .requiredOption('-t, --token <STRING>', 'Figma API token, ' + 'required'.yellow)
    .option(
        '-o, --output <OUTPUT>',
        'output folder',
        './icons/'
    )
    .option(
        '--ignore-subfolders',
        'ignore subfolders in icon\'s name (e. g. «socials/facebook» will be converted to «socials-facebook»)',
        false
    )
    .option('--svgo-conf <CONFIG>', 'custom SVGo config file, only .json is supported')
    .option(
        '--monochrome-colors <COLORS>', 
        'list of monochromatic colors. An icon will be considered monochrome if it filled with one of these colors',
        'black,000000'
    ) 
    .option(
        '--remove-fill', 
        'remove fill="color" from SVG if the icon is considered monochrome',
        false
    )
    .option(
        '--remove-stroke', 
        'remove stroke="color" from SVG if the icon is considered monochrome',
        false
    )
    .option(
        '-q, --quiet',
        'output only critical error messages',
        false
    )
    .option(
        '-f, --force',
        'force re-fetch all icons ignoring the icons stored locally',
        false
    )
    .option('--no-color', 'output plain text without color')
    .action((str, opts) => {
        if(str == undefined) {
            throw new Error('No URL specified: provide a link directly to a frame in the Figma file');
        }

        const { fileId, nodeId } = extractFileIdsFromUrl(str);

        let svgoConf = false;
        if('svgoConf' in opts) {
            if(opts.svgoConf.split('.').pop() !== 'json') {
                throw new Error(`SVGo config file '${opts.svgoConf}' should have .json extension`);
            } else if(!fs.existsSync(opts.svgoConf)) {
                throw new Error(`SVGo config file '${opts.svgoConf}' does not exist`);
            } else {
                try {
                    const _contents = JSON.parse(fs.readFileSync(opts.svgoConf));
                    if(typeof _contents !== 'object') {
                        throw new Error(`SVGo config file '${opts.svgoConf}' isn't a valid JSON file (object expected)`);
                    }

                    svgoConf = _contents;
                } catch(err) {
                    throw new Error(`SVGo config file '${opts.svgoConf}' isn't a valid JSON file`);
                }
            }
        }

        const options = {
            token: opts.token,
            outputDirectory: opts.output + (opts.output.endsWith('/') ? '' : '/'),
            ignoreSubfolders: opts.ignoreSubfolders,

            monochrome: {
                colors: opts.monochromeColors.split(','),
                removeFill: opts.removeFill,
                removeStroke: opts.removeStroke,
            },
    
            fileId: fileId,
            nodeId: nodeId,

            cli: {
                enabled: true,
                quiet: opts.quiet
            },

            svgoConfig: svgoConf !== false ? svgoConf : _defaultSVGoSettings
        };
    
        const syncer = new FigmaSync(options);
    
        new Promise(async (resolve, reject) => {
            try {
                const result = await syncer.extractIcons(opts.force);
                resolve(result);
            } catch(err) {
                reject(err);
            }
        }).catch(err => {
            process.stdout.clearLine(0);
            process.stdout.write('Sync Error'.white.bgRed + '\n');
            console.error(err);
        });

    });

program.parse();